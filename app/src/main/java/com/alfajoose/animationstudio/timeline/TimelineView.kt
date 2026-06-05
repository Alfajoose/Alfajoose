package com.alfajoose.animationstudio.timeline

import android.content.Context
import android.graphics.*
import android.util.AttributeSet
import android.view.GestureDetector
import android.view.MotionEvent
import android.view.View
import com.alfajoose.animationstudio.viewmodel.AnimationViewModel

class TimelineView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null
) : View(context, attrs) {

    var viewModel: AnimationViewModel? = null
    var onFrameSelected: ((Int) -> Unit)? = null

    private val frameWidth = 100f
    private val frameHeight = 80f
    private val framePadding = 8f
    private val borderRadius = 8f

    private val bgPaint = Paint().apply { color = Color.parseColor("#1E1E2E") }
    private val frameBgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#2E2E4E") }
    private val activeFramePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#5865F2") }
    private val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 2f
        color = Color.parseColor("#5865F2")
    }
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        textSize = 24f
        textAlign = Paint.Align.CENTER
    }
    private val addBtnPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#44475A")
    }
    private val addBtnTextPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#BD93F9")
        textSize = 36f
        textAlign = Paint.Align.CENTER
    }
    private val durationPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#888AAA")
        textSize = 20f
        textAlign = Paint.Align.CENTER
    }

    private var scrollX = 0f
    private val gestureDetector = GestureDetector(context, object : GestureDetector.SimpleOnGestureListener() {
        override fun onScroll(e1: MotionEvent?, e2: MotionEvent, dx: Float, dy: Float): Boolean {
            scrollX += dx
            scrollX = scrollX.coerceAtLeast(0f)
            invalidate()
            return true
        }

        override fun onSingleTapUp(e: MotionEvent): Boolean {
            val tappedIndex = getTappedFrameIndex(e.x + scrollX, e.y)
            if (tappedIndex >= 0) {
                onFrameSelected?.invoke(tappedIndex)
                invalidate()
            }
            return true
        }
    })

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val vm = viewModel ?: return

        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), bgPaint)

        val totalFrames = vm.project.frames.size
        val activeIdx = vm.project.activeFrameIndex

        for (i in 0 until totalFrames) {
            val left = i * (frameWidth + framePadding) - scrollX
            val top = (height - frameHeight) / 2f
            val right = left + frameWidth
            val bottom = top + frameHeight
            val rect = RectF(left, top, right, bottom)

            if (right < 0 || left > width) continue

            val isActive = i == activeIdx
            canvas.drawRoundRect(rect, borderRadius, borderRadius, if (isActive) activeFramePaint else frameBgPaint)
            if (isActive) {
                canvas.drawRoundRect(rect, borderRadius, borderRadius, borderPaint)
            }

            // Thumbnail
            val thumb = vm.getFrameThumbnail(i)
            if (thumb != null) {
                val thumbRect = RectF(left + 4f, top + 4f, right - 4f, bottom - 26f)
                canvas.save()
                canvas.clipRect(thumbRect)
                val thumbScale = thumbRect.width() / thumb.width
                val scaledH = thumb.height * thumbScale
                val thumbTop = thumbRect.top + (thumbRect.height() - scaledH) / 2f
                canvas.drawBitmap(thumb, null, RectF(thumbRect.left, thumbTop, thumbRect.right, thumbTop + scaledH), null)
                canvas.restore()
            }

            // Frame number and duration
            canvas.drawText("${i + 1}", left + frameWidth / 2, bottom - 6f, textPaint)
        }

        // Add frame button
        val addLeft = totalFrames * (frameWidth + framePadding) - scrollX
        val addTop = (height - frameHeight) / 2f
        val addRect = RectF(addLeft, addTop, addLeft + frameWidth, addTop + frameHeight)
        canvas.drawRoundRect(addRect, borderRadius, borderRadius, addBtnPaint)
        canvas.drawText("+", addLeft + frameWidth / 2, addTop + frameHeight / 2 + 12f, addBtnTextPaint)
    }

    private fun getTappedFrameIndex(x: Float, y: Float): Int {
        val vm = viewModel ?: return -1
        val top = (height - frameHeight) / 2f
        val bottom = top + frameHeight
        if (y < top || y > bottom) return -1
        val idx = (x / (frameWidth + framePadding)).toInt()
        return if (idx >= 0 && idx < vm.project.frames.size) idx else -1
    }

    fun isAddButtonTapped(x: Float, y: Float): Boolean {
        val vm = viewModel ?: return false
        val top = (height - frameHeight) / 2f
        val bottom = top + frameHeight
        val addLeft = vm.project.frames.size * (frameWidth + framePadding) - scrollX
        val addRight = addLeft + frameWidth
        return x >= addLeft && x <= addRight && y >= top && y <= bottom
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (event.action == MotionEvent.ACTION_UP) {
            if (isAddButtonTapped(event.x, event.y)) {
                viewModel?.addFrame()
                invalidate()
                return true
            }
        }
        return gestureDetector.onTouchEvent(event) || super.onTouchEvent(event)
    }

    fun scrollToFrame(index: Int) {
        val vm = viewModel ?: return
        val targetScroll = index * (frameWidth + framePadding) - width / 2f + frameWidth / 2f
        scrollX = targetScroll.coerceAtLeast(0f)
        invalidate()
    }
}
