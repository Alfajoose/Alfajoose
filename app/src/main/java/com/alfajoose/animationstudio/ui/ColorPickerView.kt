package com.alfajoose.animationstudio.ui

import android.content.Context
import android.graphics.*
import android.util.AttributeSet
import android.view.MotionEvent
import android.view.View
import kotlin.math.*

class ColorPickerView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null
) : View(context, attrs) {

    var onColorSelected: ((Int) -> Unit)? = null

    private var hue = 0f
    private var saturation = 1f
    private var value = 1f
    private var alpha = 255

    private val hueGradient: SweepGradient by lazy {
        val colors = IntArray(361) { i ->
            Color.HSVToColor(floatArrayOf(i.toFloat(), 1f, 1f))
        }
        SweepGradient(wheelCenterX, wheelCenterY, colors, null)
    }

    private val huePaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val satValPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val selectorPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 3f
        color = Color.WHITE
    }
    private val selectorShadowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = 5f
        color = Color.BLACK
    }
    private val previewPaint = Paint(Paint.ANTI_ALIAS_FLAG)

    private var wheelCenterX = 0f
    private var wheelCenterY = 0f
    private var wheelRadius = 0f
    private var innerRadius = 0f
    private var svBoxLeft = 0f
    private var svBoxTop = 0f
    private var svBoxSize = 0f

    private var draggingHue = false
    private var draggingSV = false

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        val size = min(w, h).toFloat()
        wheelCenterX = w / 2f
        wheelCenterY = h * 0.45f
        wheelRadius = size * 0.42f
        innerRadius = wheelRadius * 0.68f
        svBoxSize = innerRadius * 1.3f
        svBoxLeft = wheelCenterX - svBoxSize / 2f
        svBoxTop = wheelCenterY - svBoxSize / 2f
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        drawHueWheel(canvas)
        drawSVSquare(canvas)
        drawHueSelector(canvas)
        drawSVSelector(canvas)
        drawColorPreview(canvas)
    }

    private fun drawHueWheel(canvas: Canvas) {
        huePaint.shader = SweepGradient(
            wheelCenterX, wheelCenterY,
            IntArray(361) { i -> Color.HSVToColor(floatArrayOf(i.toFloat(), 1f, 1f)) },
            null
        )
        huePaint.style = Paint.Style.STROKE
        huePaint.strokeWidth = (wheelRadius - innerRadius)

        canvas.save()
        canvas.rotate(-90f, wheelCenterX, wheelCenterY)
        val r = (wheelRadius + innerRadius) / 2f
        canvas.drawCircle(wheelCenterX, wheelCenterY, r, huePaint)
        canvas.restore()
    }

    private fun drawSVSquare(canvas: Canvas) {
        val rect = RectF(svBoxLeft, svBoxTop, svBoxLeft + svBoxSize, svBoxTop + svBoxSize)
        val baseColor = Color.HSVToColor(floatArrayOf(hue, 1f, 1f))

        val hGrad = LinearGradient(rect.left, 0f, rect.right, 0f,
            Color.WHITE, baseColor, Shader.TileMode.CLAMP)
        val vGrad = LinearGradient(0f, rect.top, 0f, rect.bottom,
            Color.TRANSPARENT, Color.BLACK, Shader.TileMode.CLAMP)
        val composeShader = ComposeShader(vGrad, hGrad, PorterDuff.Mode.MULTIPLY)

        satValPaint.shader = composeShader
        val clipPath = Path().apply { addCircle(wheelCenterX, wheelCenterY, innerRadius - 4f, Path.Direction.CW) }
        canvas.save()
        canvas.clipPath(clipPath)
        canvas.drawRect(rect, satValPaint)
        canvas.restore()
    }

    private fun drawHueSelector(canvas: Canvas) {
        val angle = (hue - 90f) * PI.toFloat() / 180f
        val r = (wheelRadius + innerRadius) / 2f
        val sx = wheelCenterX + r * cos(angle)
        val sy = wheelCenterY + r * sin(angle)
        canvas.drawCircle(sx, sy, 12f, selectorShadowPaint)
        canvas.drawCircle(sx, sy, 12f, selectorPaint)
    }

    private fun drawSVSelector(canvas: Canvas) {
        val sx = svBoxLeft + saturation * svBoxSize
        val sy = svBoxTop + (1f - value) * svBoxSize
        canvas.drawCircle(sx, sy, 12f, selectorShadowPaint)
        canvas.drawCircle(sx, sy, 12f, selectorPaint)
    }

    private fun drawColorPreview(canvas: Canvas) {
        val currentColor = getCurrentColor()
        previewPaint.color = currentColor
        val previewY = wheelCenterY + wheelRadius + 20f
        val previewRadius = 20f
        canvas.drawCircle(wheelCenterX, previewY, previewRadius, previewPaint)
        val borderP = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = 2f
            color = Color.GRAY
        }
        canvas.drawCircle(wheelCenterX, previewY, previewRadius, borderP)
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        val dx = event.x - wheelCenterX
        val dy = event.y - wheelCenterY
        val dist = sqrt(dx * dx + dy * dy)

        when (event.action) {
            MotionEvent.ACTION_DOWN -> {
                draggingHue = dist >= innerRadius && dist <= wheelRadius
                draggingSV = dist < innerRadius
            }
            MotionEvent.ACTION_MOVE -> {
                if (draggingHue) {
                    hue = (atan2(dy, dx) * 180f / PI.toFloat() + 90f + 360f) % 360f
                    invalidate()
                    onColorSelected?.invoke(getCurrentColor())
                } else if (draggingSV) {
                    saturation = ((event.x - svBoxLeft) / svBoxSize).coerceIn(0f, 1f)
                    value = (1f - (event.y - svBoxTop) / svBoxSize).coerceIn(0f, 1f)
                    invalidate()
                    onColorSelected?.invoke(getCurrentColor())
                }
            }
            MotionEvent.ACTION_UP -> {
                draggingHue = false
                draggingSV = false
                onColorSelected?.invoke(getCurrentColor())
            }
        }
        return true
    }

    fun getCurrentColor(): Int = Color.HSVToColor(alpha, floatArrayOf(hue, saturation, value))

    fun setColor(color: Int) {
        val hsv = FloatArray(3)
        Color.colorToHSV(color, hsv)
        hue = hsv[0]
        saturation = hsv[1]
        value = hsv[2]
        alpha = Color.alpha(color)
        invalidate()
    }
}
