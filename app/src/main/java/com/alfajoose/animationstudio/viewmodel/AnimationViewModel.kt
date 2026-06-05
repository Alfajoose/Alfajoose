package com.alfajoose.animationstudio.viewmodel

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.os.Handler
import android.os.Looper
import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.ViewModel
import com.alfajoose.animationstudio.models.AnimationProject
import com.alfajoose.animationstudio.models.Frame
import com.alfajoose.animationstudio.models.Layer
import com.alfajoose.animationstudio.tools.DrawingTool

class AnimationViewModel : ViewModel() {

    val project = AnimationProject(canvasWidth = 1280, canvasHeight = 720)

    private val _activeFrameIndex = MutableLiveData(0)
    val activeFrameIndex: LiveData<Int> = _activeFrameIndex

    private val _activeLayerIndex = MutableLiveData(0)
    val activeLayerIndex: LiveData<Int> = _activeLayerIndex

    private val _isPlaying = MutableLiveData(false)
    val isPlaying: LiveData<Boolean> = _isPlaying

    private val _currentTool = MutableLiveData(DrawingTool.PEN)
    val currentTool: LiveData<DrawingTool> = _currentTool

    private val _brushColor = MutableLiveData(Color.BLACK)
    val brushColor: LiveData<Int> = _brushColor

    private val _brushSize = MutableLiveData(8f)
    val brushSize: LiveData<Float> = _brushSize

    private val _onionSkinEnabled = MutableLiveData(true)
    val onionSkinEnabled: LiveData<Boolean> = _onionSkinEnabled

    private val _framesChanged = MutableLiveData(0)
    val framesChanged: LiveData<Int> = _framesChanged

    private val _canvasInvalidate = MutableLiveData(0)
    val canvasInvalidate: LiveData<Int> = _canvasInvalidate

    private val undoStack = ArrayDeque<UndoAction>()
    private val redoStack = ArrayDeque<UndoAction>()

    private val playbackHandler = Handler(Looper.getMainLooper())
    private var playbackRunnable: Runnable? = null
    var isLooping = true

    data class UndoAction(val frameIndex: Int, val layerIndex: Int, val bitmap: Bitmap)

    fun getActiveFrame(): Frame? = project.getActiveFrame()

    fun getActiveLayer(): Layer? = getActiveFrame()?.getActiveLayer()

    fun setActiveFrame(index: Int) {
        project.activeFrameIndex = index
        _activeFrameIndex.value = index
        val frame = project.getActiveFrame()
        frame?.let { _activeLayerIndex.value = it.activeLayerIndex }
        _canvasInvalidate.value = (_canvasInvalidate.value ?: 0) + 1
    }

    fun setActiveLayer(index: Int) {
        val frame = getActiveFrame() ?: return
        frame.activeLayerIndex = index
        _activeLayerIndex.value = index
    }

    fun setTool(tool: DrawingTool) { _currentTool.value = tool }

    fun setBrushColor(color: Int) { _brushColor.value = color }

    fun setBrushSize(size: Float) { _brushSize.value = size }

    fun toggleOnionSkin() { _onionSkinEnabled.value = !(_onionSkinEnabled.value ?: true) }

    fun addFrame() {
        project.addFrame(project.activeFrameIndex)
        notifyFramesChanged()
        setActiveFrame(project.activeFrameIndex)
    }

    fun duplicateFrame() {
        project.duplicateFrame(project.activeFrameIndex)
        notifyFramesChanged()
        setActiveFrame(project.activeFrameIndex)
    }

    fun removeFrame() {
        project.removeFrame(project.activeFrameIndex)
        notifyFramesChanged()
        setActiveFrame(project.activeFrameIndex)
    }

    fun addLayer() {
        getActiveFrame()?.addLayer()
        _activeLayerIndex.value = getActiveFrame()?.activeLayerIndex
        _canvasInvalidate.value = (_canvasInvalidate.value ?: 0) + 1
    }

    fun removeLayer(index: Int) {
        getActiveFrame()?.removeLayer(index)
        _activeLayerIndex.value = getActiveFrame()?.activeLayerIndex
        _canvasInvalidate.value = (_canvasInvalidate.value ?: 0) + 1
    }

    fun pushUndoState() {
        val frameIndex = project.activeFrameIndex
        val frame = getActiveFrame() ?: return
        val layer = frame.getActiveLayer() ?: return
        val snapshot = layer.bitmap.copy(Bitmap.Config.ARGB_8888, false)
        undoStack.addLast(UndoAction(frameIndex, frame.activeLayerIndex, snapshot))
        if (undoStack.size > 50) undoStack.removeFirst()
        redoStack.clear()
    }

    fun undo() {
        val action = undoStack.removeLastOrNull() ?: return
        val frame = project.frames.getOrNull(action.frameIndex) ?: return
        val layer = frame.layers.getOrNull(action.layerIndex) ?: return
        val current = layer.bitmap.copy(Bitmap.Config.ARGB_8888, false)
        redoStack.addLast(UndoAction(action.frameIndex, action.layerIndex, current))
        val canvas = Canvas(layer.bitmap)
        canvas.drawColor(Color.TRANSPARENT, android.graphics.PorterDuff.Mode.CLEAR)
        canvas.drawBitmap(action.bitmap, 0f, 0f, null)
        _canvasInvalidate.value = (_canvasInvalidate.value ?: 0) + 1
        notifyFramesChanged()
    }

    fun redo() {
        val action = redoStack.removeLastOrNull() ?: return
        val frame = project.frames.getOrNull(action.frameIndex) ?: return
        val layer = frame.layers.getOrNull(action.layerIndex) ?: return
        val current = layer.bitmap.copy(Bitmap.Config.ARGB_8888, false)
        undoStack.addLast(UndoAction(action.frameIndex, action.layerIndex, current))
        val canvas = Canvas(layer.bitmap)
        canvas.drawColor(Color.TRANSPARENT, android.graphics.PorterDuff.Mode.CLEAR)
        canvas.drawBitmap(action.bitmap, 0f, 0f, null)
        _canvasInvalidate.value = (_canvasInvalidate.value ?: 0) + 1
        notifyFramesChanged()
    }

    fun startPlayback() {
        _isPlaying.value = true
        scheduleNextFrame()
    }

    fun stopPlayback() {
        _isPlaying.value = false
        playbackRunnable?.let { playbackHandler.removeCallbacks(it) }
    }

    fun togglePlayback() {
        if (_isPlaying.value == true) stopPlayback() else startPlayback()
    }

    private fun scheduleNextFrame() {
        val frame = getActiveFrame() ?: return
        val delay = frame.durationMs.toLong()
        playbackRunnable = Runnable {
            val nextIndex = project.activeFrameIndex + 1
            if (nextIndex >= project.frames.size) {
                if (isLooping) {
                    setActiveFrame(0)
                    scheduleNextFrame()
                } else {
                    stopPlayback()
                    setActiveFrame(0)
                }
            } else {
                setActiveFrame(nextIndex)
                if (_isPlaying.value == true) scheduleNextFrame()
            }
        }
        playbackHandler.postDelayed(playbackRunnable!!, delay)
    }

    fun getOnionSkinBitmaps(): Pair<Bitmap?, Bitmap?> {
        val idx = project.activeFrameIndex
        val prev = if (idx > 0) project.frames[idx - 1].compositeToSingleBitmap() else null
        val next = if (idx < project.frames.lastIndex) project.frames[idx + 1].compositeToSingleBitmap() else null
        return Pair(prev, next)
    }

    fun getFrameThumbnail(index: Int): Bitmap? {
        val frame = project.frames.getOrNull(index) ?: return null
        val composite = frame.compositeToSingleBitmap()
        val thumbW = 120
        val thumbH = (thumbW * composite.height.toFloat() / composite.width).toInt()
        return Bitmap.createScaledBitmap(composite, thumbW, thumbH, true)
    }

    fun notifyFramesChanged() {
        _framesChanged.value = (_framesChanged.value ?: 0) + 1
    }

    fun invalidateCanvas() {
        _canvasInvalidate.value = (_canvasInvalidate.value ?: 0) + 1
    }

    override fun onCleared() {
        super.onCleared()
        stopPlayback()
    }
}
