package com.alfajoose.animationstudio.models

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import java.util.UUID

class Frame(
    val id: String = UUID.randomUUID().toString(),
    val width: Int,
    val height: Int,
    var durationMs: Int = 100
) {
    val layers: MutableList<Layer> = mutableListOf()
    var activeLayerIndex: Int = 0

    init {
        layers.add(createDefaultLayer())
    }

    private fun createDefaultLayer(): Layer {
        val bmp = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        bmp.eraseColor(Color.TRANSPARENT)
        return Layer(bitmap = bmp, name = "Layer 1")
    }

    fun addLayer(): Layer {
        val bmp = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        bmp.eraseColor(Color.TRANSPARENT)
        val layer = Layer(bitmap = bmp, name = "Layer ${layers.size + 1}")
        layers.add(layer)
        activeLayerIndex = layers.lastIndex
        return layer
    }

    fun removeLayer(index: Int) {
        if (layers.size <= 1) return
        layers.removeAt(index)
        activeLayerIndex = activeLayerIndex.coerceAtMost(layers.lastIndex)
    }

    fun getActiveLayer(): Layer? = layers.getOrNull(activeLayerIndex)

    fun compositeToSingleBitmap(): Bitmap {
        val result = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(result)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        for (layer in layers) {
            layer.drawOnto(canvas, paint)
        }
        return result
    }

    fun clone(): Frame {
        val cloned = Frame(width = width, height = height, durationMs = durationMs)
        cloned.layers.clear()
        for (layer in layers) {
            cloned.layers.add(layer.clone())
        }
        cloned.activeLayerIndex = activeLayerIndex
        return cloned
    }
}
