#!/usr/bin/env node
// Audit every !important in web/frame-twelve.html.
//
// For each rule, drops all of its !important flags in a live page and re-reads
// the computed styles of every element it matches, across six states. If
// nothing moves in any of them the flag is inert and should be deleted.
//
//   node scripts/audit-important.js            # report
//   node scripts/audit-important.js out.json   # report + machine-readable dump
//
// This is how the count went from 124 to 57 without a single pixel moving.
// Run it before adding a new !important, and after touching the cascade.
// @playwright/test is the declared devDependency; import through it rather
// than the bare 'playwright' package, which is only present transitively.
const { chromium } = require('@playwright/test');

async function scan(page) {
  return page.evaluate(() => {
    const sheet = [...document.styleSheets].find(s => {
      try { return s.cssRules && s.cssRules.length > 100; } catch (_) { return false; }
    });
    const out = [];
    const walk = (rules, media) => {
      for (const rule of rules) {
        if (rule.type === CSSRule.MEDIA_RULE) { walk(rule.cssRules, rule.conditionText); continue; }
        if (!rule.style || !rule.selectorText) continue;
        const imp = [];
        for (const p of rule.style) if (rule.style.getPropertyPriority(p) === 'important') imp.push(p);
        if (!imp.length) continue;
        let els = [];
        try { els = [...document.querySelectorAll(
          rule.selectorText.replace(/::?(before|after|hover|active|focus-visible|placeholder)/g, ''))]; }
        catch (_) {}
        const vals = imp.map(p => rule.style.getPropertyValue(p));
        const before = els.map(el => { const cs = getComputedStyle(el); return imp.map(p => cs.getPropertyValue(p)); });
        imp.forEach((p, i) => rule.style.setProperty(p, vals[i], ''));
        const after = els.map(el => { const cs = getComputedStyle(el); return imp.map(p => cs.getPropertyValue(p)); });
        imp.forEach((p, i) => rule.style.setProperty(p, vals[i], 'important'));
        let changed = false;
        for (let e = 0; e < before.length && !changed; e++)
          for (let k = 0; k < imp.length; k++)
            if (before[e][k] !== after[e][k]) { changed = true; break; }
        out.push({ selector: rule.selectorText, media: media || '', matched: els.length, changed });
      }
    };
    walk(sheet.cssRules, null);
    return out;
  });
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const agg = new Map();
  const states = [
    { w: 1280, h: 860, label: 'desktop' },
    { w: 412, h: 915, label: 'phone' },
    { w: 412, h: 915, label: 'phone-focus', focus: true },
    { w: 320, h: 700, label: 'narrow' },
    { w: 915, h: 412, label: 'landscape' },
    { w: 412, h: 915, label: 'phone-modal', modal: true },
  ];
  for (const st of states) {
    const p = await b.newPage({ viewport: { width: st.w, height: st.h }, hasTouch: st.w < 600, isMobile: st.w < 600 });
    await p.goto('file://' + require('path').resolve(__dirname, '..', 'web', 'frame-twelve.html'), { waitUntil: 'load' });
    await p.waitForTimeout(900);
    await p.click('#startup-fab'); await p.waitForTimeout(600);
    await p.getByPlaceholder('Project name').fill('R');
    await p.getByRole('button', { name: 'Create', exact: true }).click();
    await p.waitForTimeout(1400);
    // Realise as many components as possible so their rules have live elements.
    await p.evaluate(() => { try { addLayer(); } catch(_){} try { openColorPicker(); } catch(_){} });
    await p.waitForTimeout(250);
    await p.evaluate(() => { try { document.querySelector('#tl .tlbl').click(); } catch(_){} });
    await p.waitForTimeout(250);
    if (st.modal) { await p.evaluate(() => { try { openExport(); } catch(_) { document.getElementById('export-btn').click(); } }); await p.waitForTimeout(500); }
    if (st.focus) { await p.evaluate(() => toggleFocusMode(true)); await p.waitForTimeout(600); }
    for (const r of await scan(p)) {
      const key = `${r.media}||${r.selector}`;
      const prev = agg.get(key) || { ...r, neededIn: [], maxMatched: 0 };
      if (r.changed) prev.neededIn.push(st.label);
      prev.maxMatched = Math.max(prev.maxMatched, r.matched);
      agg.set(key, prev);
    }
    await p.close();
  }
  const rows = [...agg.values()];
  const needed = rows.filter(r => r.neededIn.length);
  const inert = rows.filter(r => !r.neededIn.length);
  console.log(`rules carrying !important : ${rows.length}`);
  console.log(`load-bearing              : ${needed.length}`);
  console.log(`inert                     : ${inert.length}`);
  console.log(`  of which never matched   : ${inert.filter(r => r.maxMatched === 0).length}`);
  console.log('\nNOTE: a rule is only "load-bearing" if a state that needs it was actually');
  console.log('reached. Panels this script fails to open look inert, so treat the inert');
  console.log('list as a shortlist to verify — the visual baselines are the arbiter.');
  console.log('\n=== LOAD-BEARING RULES (keep the flag, document why) ===');
  for (const r of needed) console.log(`  ${(r.media ? '@' + r.media + ' ' : '').padEnd(22)}${r.selector.slice(0, 78)}  [${r.neededIn.join(',')}]`);
  if (process.argv[2]) require('fs').writeFileSync(process.argv[2], JSON.stringify(rows, null, 1));
  await b.close();
})();
