package com.alfajoose.animationstudio.models

import java.util.UUID

class AnimationProject(
    val id: String = UUID.randomUUID().toString(),
    var name: String = "Untitled Animation",
    val canvasWidth: Int = 1920,
    val canvasHeight: Int = 1080,
    var fps: Int = 12
) {
    val frames: MutableList<Frame> = mutableListOf()
    var activeFrameIndex: Int = 0

    init {
        frames.add(Frame(width = canvasWidth, height = canvasHeight))
    }

    fun addFrame(afterIndex: Int = activeFrameIndex): Frame {
        val frame = Frame(width = canvasWidth, height = canvasHeight)
        frames.add(afterIndex + 1, frame)
        activeFrameIndex = afterIndex + 1
        return frame
    }

    fun duplicateFrame(index: Int): Frame {
        val cloned = frames[index].clone()
        frames.add(index + 1, cloned)
        activeFrameIndex = index + 1
        return cloned
    }

    fun removeFrame(index: Int) {
        if (frames.size <= 1) return
        frames.removeAt(index)
        activeFrameIndex = activeFrameIndex.coerceAtMost(frames.lastIndex)
    }

    fun getActiveFrame(): Frame? = frames.getOrNull(activeFrameIndex)

    fun totalDurationMs(): Int = frames.sumOf { it.durationMs }
}
