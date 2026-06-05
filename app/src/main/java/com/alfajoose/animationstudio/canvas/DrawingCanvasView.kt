package com.alfajoose.animationstudio.canvas

import android.content.Context
import android.graphics.*
import android.util.AttributeSet
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import com.alfajoose.animationstudio.tools.DrawingTool
import com.alfajoose.animationstudio.viewmodel.AnimationViewModel
import kotlin.math.max
import kotlin.math.min

class DrawingCanvasView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null
) : View(context, attrs) {

    var viewModel: AnimationViewModel? = null

    private val backgroundPaint = Paint().apply { color = Color.WHITE }
    private val checkerPaint = Paint()
    private val layerPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val onionPrevPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { alpha = 60 }
    private val onionNextPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { alpha = 40 }
    private val gridPaint = Paint().apply {
        color = Color.argb(30, 100, 100, 100)
        strokeWidth = 0.5f
        style = Paint.Style.STROKE
    }

    private val drawPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }

    private val erasePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
        xfermode = PorterDuffXfermode(PorterDuff.Mode.CLEAR)
    }

    private val cursorPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 2f
        color = Color.argb(180, 80, 80, 80)
    }

    private val selectionPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 2f
        color = Color.argb(200, 0, 120, 255)
        pathEffect = DashPathEffect(floatArrayOf(10f, 5f), 0f)
    }

    private var canvasMatrix = Matrix()
    private var inverseMatrix = Matrix()
    private var scale = 1f
    private var translateX = 0f
    private var translateY = 0f

    private var currentPath = Path()
    private var isDrawing = false
    private var lastX = 0f
    private var lastY = 0f

    private var cursorX = -1f
    private var cursorY = -1f

    private val scaleDetector = ScaleGestureDetector(context, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
        override fun onScale(detector: ScaleGestureDetector): Boolean {
            val newScale = (scale * detector.scaleFactor).coerceIn(0.1f, 20f)
            val focusX = detector.focusX
            val focusY = detector.focusY
            translateX = focusX - (focusX - translateX) * (newScale / scale)
            translateY = focusY - (focusY - translateY) * (newScale / scale)
            scale = newScale
            updateMatrix()
            invalidate()
            return true
        }
    })

    private var lastPanX = 0f
    private var lastPanY = 0f
    private var isPanning = false
    private var activePointerId = -1

    private var brushColor = Color.BLACK
    private var brushSize = 8f
    private var currentTool = DrawingTool.PEN

    fun setBrushColor(color: Int) { brushColor = color }
    fun setBrushSize(size: Float) { brushSize = size }
    fun setTool(tool: DrawingTool) { currentTool = tool }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        fitCanvasToView()
    }

    private fun fitCanvasToView() {
        val vm = viewModel ?: return
        val cw = vm.project.canvasWidth.toFloat()
        val ch = vm.project.canvasHeight.toFloat()
        val vw = width.toFloat()
        val vh = height.toFloat()
        if (vw <= 0 || vh <= 0) return
        scale = min(vw / cw, vh / ch) * 0.9f
        translateX = (vw - cw * scale) / 2f
        translateY = (vh - ch * scale) / 2f
        updateMatrix()
    }

    private fun updateMatrix() {
        canvasMatrix.reset()
        canvasMatrix.postScale(scale, scale)
        canvasMatrix.postTranslate(translateX, translateY)
        canvasMatrix.invert(inverseMatrix)
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val vm = viewModel ?: return
        val frame = vm.getActiveFrame() ?: return

        canvas.save()
        canvas.setMatrix(canvasMatrix)

        val cw = vm.project.canvasWidth.toFloat()
        val ch = vm.project.canvasHeight.toFloat()

        // Background
        canvas.drawRect(0f, 0f, cw, ch, backgroundPaint)
        drawCheckerboard(canvas, cw.toInt(), ch.toInt())

        // Onion skinning
        if (vm.onionSkinEnabled.value == true) {
            val (prev, next) = vm.getOnionSkinBitmaps()
            prev?.let { bmp ->
                val tinted = tintBitmap(bmp, Color.argb(60, 255, 50, 50))
                canvas.drawBitmap(tinted, 0f, 0f, null)
            }
            next?.let { bmp ->
                val tinted = tintBitmap(bmp, Color.argb(40, 50, 50, 255))
                canvas.drawBitmap(tinted, 0f, 0f, null)
            }
        }

        // Draw all layers
        for (layer in frame.layers) {
            layer.drawOnto(canvas, layerPaint)
        }

        // Draw canvas border
        val borderPaint = Paint().apply {
            style = Paint.Style.STROKE
            color = Color.argb(80, 0, 0, 0)
            strokeWidth = 1f / scale
        }
        canvas.drawRect(0f, 0f, cw, ch, borderPaint)

        canvas.restore()

        // Draw cursor ring (in screen coords)
        if (cursorX >= 0 && cursorY >= 0 && (currentTool == DrawingTool.PEN || currentTool == DrawingTool.BRUSH || currentTool == DrawingTool.ERASER)) {
            val radius = (brushSize * scale / 2f).coerceAtLeast(4f)
            canvas.drawCircle(cursorX, cursorY, radius, cursorPaint)
        }
    }

    private fun drawCheckerboard(canvas: Canvas, w: Int, h: Int) {
        val tileSize = 16
        val light = Color.argb(255, 200, 200, 200)
        val dark = Color.argb(255, 160, 160, 160)
        val p = Paint()
        var row = 0
        var y = 0
        while (y < h) {
            var col = 0
            var x = 0
            while (x < w) {
                p.color = if ((row + col) % 2 == 0) light else dark
                canvas.drawRect(x.toFloat(), y.toFloat(),
                    min(x + tileSize, w).toFloat(), min(y + tileSize, h).toFloat(), p)
                x += tileSize
                col++
            }
            y += tileSize
            row++
        }
    }

    private fun tintBitmap(src: Bitmap, tintColor: Int): Bitmap {
        val out = Bitmap.createBitmap(src.width, src.height, Bitmap.Config.ARGB_8888)
        val c = Canvas(out)
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        p.colorFilter = PorterDuffColorFilter(tintColor, PorterDuff.Mode.SRC_ATOP)
        c.drawBitmap(src, 0f, 0f, p)
        return out
    }

    private fun screenToCanvas(sx: Float, sy: Float): FloatArray {
        val pts = floatArrayOf(sx, sy)
        inverseMatrix.mapPoints(pts)
        return pts
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        val vm = viewModel ?: return false
        if (vm.isPlaying.value == true) return false

        scaleDetector.onTouchEvent(event)

        val pointerCount = event.pointerCount
        val action = event.actionMasked

        // Use two-finger gesture for panning
        if (pointerCount >= 2 && !scaleDetector.isInProgress) {
            if (action == MotionEvent.ACTION_POINTER_DOWN) {
                if (!isDrawing) isPanning = true
            }
        }

        when (action) {
            MotionEvent.ACTION_DOWN -> {
                if (pointerCount == 1) {
                    val canvasPt = screenToCanvas(event.x, event.y)
                    onTouchStart(canvasPt[0], canvasPt[1], vm)
                    cursorX = event.x
                    cursorY = event.y
                }
                activePointerId = event.getPointerId(0)
            }
            MotionEvent.ACTION_MOVE -> {
                if (pointerCount == 1 && !isPanning && !scaleDetector.isInProgress) {
                    val idx = event.findPointerIndex(activePointerId)
                    if (idx >= 0) {
                        val canvasPt = screenToCanvas(event.getX(idx), event.getY(idx))
                        onTouchMove(canvasPt[0], canvasPt[1], vm)
                        cursorX = event.getX(idx)
                        cursorY = event.getY(idx)
                    }
                } else if (pointerCount == 2 && isPanning && !scaleDetector.isInProgress) {
                    val cx = (event.getX(0) + event.getX(1)) / 2f
                    val cy = (event.getY(0) + event.getY(1)) / 2f
                    translateX += cx - lastPanX
                    translateY += cy - lastPanY
                    lastPanX = cx
                    lastPanY = cy
                    updateMatrix()
                    invalidate()
                }
                if (pointerCount == 2) {
                    lastPanX = (event.getX(0) + event.getX(1)) / 2f
                    lastPanY = (event.getY(0) + event.getY(1)) / 2f
                }
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                onTouchEnd(vm)
                isPanning = false
                cursorX = -1f
                cursorY = -1f
                activePointerId = -1
                invalidate()
            }
            MotionEvent.ACTION_POINTER_UP -> {
                if (pointerCount <= 2) isPanning = false
            }
        }
        return true
    }

    private fun onTouchStart(x: Float, y: Float, vm: AnimationViewModel) {
        vm.pushUndoState()
        when (currentTool) {
            DrawingTool.PEN, DrawingTool.BRUSH, DrawingTool.ERASER -> {
                isDrawing = true
                currentPath.reset()
                currentPath.moveTo(x, y)
                lastX = x
                lastY = y
            }
            DrawingTool.FILL -> {
                floodFill(x.toInt(), y.toInt(), vm)
            }
            else -> {}
        }
    }

    private fun onTouchMove(x: Float, y: Float, vm: AnimationViewModel) {
        if (!isDrawing) return
        val layer = vm.getActiveLayer() ?: return
        val paint = buildDrawPaint()
        val c = Canvas(layer.bitmap)
        currentPath.quadTo(lastX, lastY, (x + lastX) / 2, (y + lastY) / 2)
        c.drawPath(currentPath, paint)
        currentPath.reset()
        currentPath.moveTo((x + lastX) / 2, (y + lastY) / 2)
        lastX = x
        lastY = y
        invalidate()
        vm.notifyFramesChanged()
    }

    private fun onTouchEnd(vm: AnimationViewModel) {
        if (!isDrawing) return
        isDrawing = false
        val layer = vm.getActiveLayer() ?: return
        val paint = buildDrawPaint()
        val c = Canvas(layer.bitmap)
        c.drawPath(currentPath, paint)
        currentPath.reset()
        invalidate()
        vm.notifyFramesChanged()
    }

    private fun buildDrawPaint(): Paint {
        return when (currentTool) {
            DrawingTool.ERASER -> {
                Paint(erasePaint).apply { strokeWidth = brushSize }
            }
            DrawingTool.BRUSH -> {
                Paint(drawPaint).apply {
                    color = brushColor
                    strokeWidth = brushSize * 2.5f
                    alpha = 160
                    maskFilter = BlurMaskFilter(brushSize * 0.8f, BlurMaskFilter.Blur.NORMAL)
                }
            }
            else -> {
                Paint(drawPaint).apply {
                    color = brushColor
                    strokeWidth = brushSize
                }
            }
        }
    }

    private fun floodFill(startX: Int, startY: Int, vm: AnimationViewModel) {
        val layer = vm.getActiveLayer() ?: return
        val bmp = layer.bitmap
        if (startX < 0 || startY < 0 || startX >= bmp.width || startY >= bmp.height) return
        val targetColor = bmp.getPixel(startX, startY)
        val fillColor = brushColor
        if (targetColor == fillColor) return
        val pixels = IntArray(bmp.width * bmp.height)
        bmp.getPixels(pixels, 0, bmp.width, 0, 0, bmp.width, bmp.height)
        val stack = ArrayDeque<Int>()
        stack.addLast(startY * bmp.width + startX)
        while (stack.isNotEmpty()) {
            val idx = stack.removeLast()
            if (pixels[idx] != targetColor) continue
            pixels[idx] = fillColor
            val x = idx % bmp.width
            val y = idx / bmp.width
            if (x > 0) stack.addLast(idx - 1)
            if (x < bmp.width - 1) stack.addLast(idx + 1)
            if (y > 0) stack.addLast(idx - bmp.width)
            if (y < bmp.height - 1) stack.addLast(idx + bmp.width)
        }
        bmp.setPixels(pixels, 0, bmp.width, 0, 0, bmp.width, bmp.height)
        invalidate()
        vm.notifyFramesChanged()
    }

    fun fitToScreen() {
        fitCanvasToView()
        invalidate()
    }

    fun zoomIn() {
        scale = min(scale * 1.25f, 20f)
        updateMatrix()
        invalidate()
    }

    fun zoomOut() {
        scale = max(scale / 1.25f, 0.1f)
        updateMatrix()
        invalidate()
    }
}
