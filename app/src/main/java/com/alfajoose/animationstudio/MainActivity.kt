package com.alfajoose.animationstudio

import android.app.AlertDialog
import android.graphics.Color
import android.os.Bundle
import android.view.View
import android.widget.*
import androidx.activity.viewModels
import androidx.appcompat.app.AppCompatActivity
import com.alfajoose.animationstudio.canvas.DrawingCanvasView
import com.alfajoose.animationstudio.timeline.TimelineView
import com.alfajoose.animationstudio.tools.DrawingTool
import com.alfajoose.animationstudio.ui.ColorPickerView
import com.alfajoose.animationstudio.ui.LayersPanelFragment
import com.alfajoose.animationstudio.viewmodel.AnimationViewModel

class MainActivity : AppCompatActivity() {

    private val viewModel: AnimationViewModel by viewModels()

    private lateinit var canvasView: DrawingCanvasView
    private lateinit var timelineView: TimelineView
    private lateinit var toolsPanel: LinearLayout
    private lateinit var layersPanelContainer: FrameLayout
    private lateinit var colorPreview: View
    private lateinit var playPauseBtn: ImageButton
    private lateinit var onionSkinBtn: Button
    private lateinit var undoBtn: ImageButton
    private lateinit var redoBtn: ImageButton
    private lateinit var layersBtn: ImageButton
    private lateinit var brushSizeSeek: SeekBar

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        buildUI()
        setupObservers()
        setupToolbar()
    }

    private fun buildUI() {
        // Root: dark background horizontal split
        val root = RelativeLayout(this).apply {
            setBackgroundColor(Color.parseColor("#13131F"))
        }
        setContentView(root)

        // ---- Left toolbar (tools) ----
        toolsPanel = LinearLayout(this).apply {
            id = View.generateViewId()
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#1E1E2E"))
            setPadding(4, 8, 4, 8)
        }
        val toolsParams = RelativeLayout.LayoutParams(120, RelativeLayout.LayoutParams.MATCH_PARENT)
        toolsParams.addRule(RelativeLayout.ALIGN_PARENT_LEFT)
        root.addView(toolsPanel, toolsParams)

        // ---- Right layers panel (hidden by default) ----
        layersPanelContainer = FrameLayout(this).apply {
            id = View.generateViewId()
            visibility = View.GONE
        }
        val layersParams = RelativeLayout.LayoutParams(220, RelativeLayout.LayoutParams.MATCH_PARENT)
        layersParams.addRule(RelativeLayout.ALIGN_PARENT_RIGHT)
        root.addView(layersPanelContainer, layersParams)

        // ---- Top toolbar ----
        val topBar = LinearLayout(this).apply {
            id = View.generateViewId()
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Color.parseColor("#1E1E2E"))
            gravity = android.view.Gravity.CENTER_VERTICAL
            setPadding(8, 0, 8, 0)
        }
        val topBarParams = RelativeLayout.LayoutParams(RelativeLayout.LayoutParams.MATCH_PARENT, 96)
        topBarParams.addRule(RelativeLayout.ALIGN_PARENT_TOP)
        topBarParams.addRule(RelativeLayout.RIGHT_OF, toolsPanel.id)
        topBarParams.addRule(RelativeLayout.LEFT_OF, layersPanelContainer.id)
        root.addView(topBar, topBarParams)

        // ---- Canvas area ----
        canvasView = DrawingCanvasView(this).apply {
            id = View.generateViewId()
            viewModel = this@MainActivity.viewModel
        }
        val canvasParams = RelativeLayout.LayoutParams(
            RelativeLayout.LayoutParams.MATCH_PARENT,
            RelativeLayout.LayoutParams.MATCH_PARENT
        )
        canvasParams.addRule(RelativeLayout.BELOW, topBar.id)
        canvasParams.addRule(RelativeLayout.RIGHT_OF, toolsPanel.id)
        canvasParams.addRule(RelativeLayout.LEFT_OF, layersPanelContainer.id)
        canvasParams.addRule(RelativeLayout.ABOVE, View.generateViewId()) // placeholder, set after timeline
        root.addView(canvasView, canvasParams)

        // ---- Timeline at bottom ----
        timelineView = TimelineView(this).apply {
            id = View.generateViewId()
            viewModel = this@MainActivity.viewModel
            onFrameSelected = { idx -> this@MainActivity.viewModel.setActiveFrame(idx) }
        }
        val timelineParams = RelativeLayout.LayoutParams(RelativeLayout.LayoutParams.MATCH_PARENT, 160)
        timelineParams.addRule(RelativeLayout.ALIGN_PARENT_BOTTOM)
        timelineParams.addRule(RelativeLayout.RIGHT_OF, toolsPanel.id)
        root.addView(timelineView, timelineParams)

        // Fix canvas above timeline
        (canvasView.layoutParams as RelativeLayout.LayoutParams).apply {
            addRule(RelativeLayout.ABOVE, timelineView.id)
        }
        canvasView.requestLayout()

        // ---- Populate tools panel ----
        populateToolsPanel()

        // ---- Populate top bar ----
        populateTopBar(topBar)

        // ---- Add layers fragment ----
        supportFragmentManager.beginTransaction()
            .replace(layersPanelContainer.id, LayersPanelFragment())
            .commit()
    }

    private fun populateToolsPanel() {
        val tools = listOf(
            Triple(DrawingTool.PEN, "Pen", android.R.drawable.ic_menu_edit),
            Triple(DrawingTool.BRUSH, "Brush", android.R.drawable.ic_menu_myplaces),
            Triple(DrawingTool.ERASER, "Erase", android.R.drawable.ic_menu_close_clear_cancel),
            Triple(DrawingTool.FILL, "Fill", android.R.drawable.ic_menu_crop),
        )

        tools.forEach { (tool, label, icon) ->
            val btn = createToolButton(icon, label) {
                viewModel.setTool(tool)
                canvasView.setTool(tool)
            }
            toolsPanel.addView(btn)
        }

        // Divider
        toolsPanel.addView(View(this).apply {
            setBackgroundColor(Color.parseColor("#44475A"))
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 1).apply {
            setMargins(8, 8, 8, 8)
        })

        // Color preview button
        colorPreview = View(this).apply {
            setBackgroundColor(Color.BLACK)
            setOnClickListener { showColorPicker() }
        }
        val colorParams = LinearLayout.LayoutParams(64, 64).apply {
            setMargins(28, 8, 28, 8)
        }
        toolsPanel.addView(colorPreview, colorParams)

        // Brush size label
        val sizeLabel = TextView(this).apply {
            text = "Size"
            setTextColor(Color.parseColor("#888AAA"))
            textSize = 11f
            gravity = android.view.Gravity.CENTER
        }
        toolsPanel.addView(sizeLabel, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ))

        // Brush size seekbar (vertical via rotation)
        brushSizeSeek = SeekBar(this).apply {
            max = 100
            progress = 8
            rotation = -90f
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(sb: SeekBar, progress: Int, fromUser: Boolean) {
                    val size = 1f + progress * 0.5f
                    viewModel.setBrushSize(size)
                    canvasView.setBrushSize(size)
                }
                override fun onStartTrackingTouch(sb: SeekBar) {}
                override fun onStopTrackingTouch(sb: SeekBar) {}
            })
        }
        toolsPanel.addView(brushSizeSeek, LinearLayout.LayoutParams(100, 200).apply {
            setMargins(10, 16, 10, 16)
        })

        // Zoom buttons
        createToolButton(android.R.drawable.ic_menu_zoom, "Fit") {
            canvasView.fitToScreen()
        }.also { toolsPanel.addView(it) }
    }

    private fun populateTopBar(topBar: LinearLayout) {
        // Project name
        val titleText = TextView(this).apply {
            text = viewModel.project.name
            setTextColor(Color.WHITE)
            textSize = 16f
            setPadding(16, 0, 0, 0)
        }
        topBar.addView(titleText, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))

        // Undo
        undoBtn = createIconBtn(android.R.drawable.ic_menu_revert) { viewModel.undo() }
        topBar.addView(undoBtn, LinearLayout.LayoutParams(80, 80))

        // Redo
        redoBtn = createIconBtn(android.R.drawable.ic_menu_revert) { viewModel.redo() }.apply {
            scaleX = -1f
        }
        topBar.addView(redoBtn, LinearLayout.LayoutParams(80, 80))

        // Spacer
        topBar.addView(View(this), LinearLayout.LayoutParams(16, 1))

        // Play/Pause
        playPauseBtn = createIconBtn(android.R.drawable.ic_media_play) { viewModel.togglePlayback() }
        topBar.addView(playPauseBtn, LinearLayout.LayoutParams(80, 80))

        // Stop
        val stopBtn = createIconBtn(android.R.drawable.ic_media_pause) { viewModel.stopPlayback() }
        topBar.addView(stopBtn, LinearLayout.LayoutParams(80, 80))

        // Add frame
        val addFrameBtn = createIconBtn(android.R.drawable.ic_input_add) {
            viewModel.addFrame()
        }
        topBar.addView(addFrameBtn, LinearLayout.LayoutParams(80, 80))

        // Duplicate frame
        val dupBtn = Button(this).apply {
            text = "Dup"
            setTextColor(Color.parseColor("#BD93F9"))
            setBackgroundColor(Color.TRANSPARENT)
            setOnClickListener { viewModel.duplicateFrame() }
        }
        topBar.addView(dupBtn, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, 80))

        // Delete frame
        val delFrameBtn = Button(this).apply {
            text = "Del"
            setTextColor(Color.parseColor("#FF6B6B"))
            setBackgroundColor(Color.TRANSPARENT)
            setOnClickListener {
                AlertDialog.Builder(this@MainActivity)
                    .setTitle("Delete Frame")
                    .setMessage("Delete the current frame?")
                    .setPositiveButton("Delete") { _, _ -> viewModel.removeFrame() }
                    .setNegativeButton("Cancel", null)
                    .show()
            }
        }
        topBar.addView(delFrameBtn, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, 80))

        // Onion skin toggle
        onionSkinBtn = Button(this).apply {
            text = "Onion"
            setTextColor(Color.parseColor("#50FA7B"))
            setBackgroundColor(Color.TRANSPARENT)
            setOnClickListener { viewModel.toggleOnionSkin() }
        }
        topBar.addView(onionSkinBtn, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, 80))

        // FPS label
        val fpsLabel = TextView(this).apply {
            text = "${viewModel.project.fps} FPS"
            setTextColor(Color.parseColor("#888AAA"))
            textSize = 12f
            setPadding(8, 0, 8, 0)
        }
        topBar.addView(fpsLabel, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
            gravity = android.view.Gravity.CENTER_VERTICAL
        })

        // Layers toggle
        layersBtn = createIconBtn(android.R.drawable.ic_dialog_info) {
            val visible = layersPanelContainer.visibility == View.VISIBLE
            layersPanelContainer.visibility = if (visible) View.GONE else View.VISIBLE
        }
        topBar.addView(layersBtn, LinearLayout.LayoutParams(80, 80))
    }

    private fun createToolButton(iconRes: Int, label: String, onClick: () -> Unit): LinearLayout {
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = android.view.Gravity.CENTER
            setPadding(4, 6, 4, 6)
            setOnClickListener { onClick() }
            isClickable = true
            isFocusable = true
        }
        val img = ImageView(this).apply {
            setImageResource(iconRes)
            setColorFilter(Color.WHITE)
        }
        val txt = TextView(this).apply {
            text = label
            setTextColor(Color.parseColor("#888AAA"))
            textSize = 9f
            gravity = android.view.Gravity.CENTER
        }
        container.addView(img, LinearLayout.LayoutParams(48, 48).apply { gravity = android.view.Gravity.CENTER_HORIZONTAL })
        container.addView(txt, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        return container
    }

    private fun createIconBtn(iconRes: Int, onClick: () -> Unit): ImageButton {
        return ImageButton(this).apply {
            setImageResource(iconRes)
            setBackgroundColor(Color.TRANSPARENT)
            setColorFilter(Color.WHITE)
            setOnClickListener { onClick() }
        }
    }

    private fun showColorPicker() {
        val dialog = AlertDialog.Builder(this)
        val picker = ColorPickerView(this)
        picker.setColor(viewModel.brushColor.value ?: Color.BLACK)
        picker.onColorSelected = { color ->
            viewModel.setBrushColor(color)
            canvasView.setBrushColor(color)
            colorPreview.setBackgroundColor(color)
        }
        dialog.setTitle("Choose Color")
        dialog.setView(picker)
        dialog.setPositiveButton("OK") { _, _ ->
            val color = picker.getCurrentColor()
            viewModel.setBrushColor(color)
            canvasView.setBrushColor(color)
            colorPreview.setBackgroundColor(color)
        }
        dialog.setNegativeButton("Cancel", null)
        dialog.show()
    }

    private fun setupObservers() {
        viewModel.isPlaying.observe(this) { playing ->
            playPauseBtn.setImageResource(
                if (playing) android.R.drawable.ic_media_pause
                else android.R.drawable.ic_media_play
            )
        }

        viewModel.activeFrameIndex.observe(this) { idx ->
            timelineView.invalidate()
            timelineView.scrollToFrame(idx)
            canvasView.invalidate()
        }

        viewModel.canvasInvalidate.observe(this) {
            canvasView.invalidate()
        }

        viewModel.framesChanged.observe(this) {
            timelineView.invalidate()
        }

        viewModel.currentTool.observe(this) { tool ->
            canvasView.setTool(tool)
        }

        viewModel.brushColor.observe(this) { color ->
            canvasView.setBrushColor(color)
            colorPreview.setBackgroundColor(color)
        }

        viewModel.brushSize.observe(this) { size ->
            canvasView.setBrushSize(size)
        }
    }

    private fun setupToolbar() {
        // No ActionBar needed - fully custom UI
        supportActionBar?.hide()
    }
}
