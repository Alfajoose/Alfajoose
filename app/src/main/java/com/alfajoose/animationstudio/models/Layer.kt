package com.alfajoose.animationstudio.models

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import java.util.UUID

data class Layer(
    val id: String = UUID.randomUUID().toString(),
    var name: String = "Layer",
    var bitmap: Bitmap,
    var isVisible: Boolean = true,
    var opacity: Float = 1f,
    var blendMode: BlendMode = BlendMode.NORMAL
) {
    enum class BlendMode { NORMAL, MULTIPLY, SCREEN, OVERLAY }

    fun clone(): Layer = copy(
        id = UUID.randomUUID().toString(),
        bitmap = bitmap.copy(Bitmap.Config.ARGB_8888, true)
    )

    fun drawOnto(canvas: Canvas, paint: Paint) {
        if (!isVisible) return
        val savedAlpha = paint.alpha
        paint.alpha = (opacity * 255).toInt()
        canvas.drawBitmap(bitmap, 0f, 0f, paint)
        paint.alpha = savedAlpha
    }
}
