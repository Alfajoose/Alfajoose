package com.alfajoose.animationstudio.ui

import android.graphics.Color
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.*
import androidx.fragment.app.Fragment
import androidx.fragment.app.activityViewModels
import com.alfajoose.animationstudio.R
import com.alfajoose.animationstudio.models.Layer
import com.alfajoose.animationstudio.viewmodel.AnimationViewModel

class LayersPanelFragment : Fragment() {

    private val viewModel: AnimationViewModel by activityViewModels()
    private lateinit var listView: LinearLayout
    private lateinit var scrollView: ScrollView

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        scrollView = ScrollView(requireContext()).apply {
            setBackgroundColor(Color.parseColor("#1E1E2E"))
        }
        listView = LinearLayout(requireContext()).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(8, 8, 8, 8)
        }
        scrollView.addView(listView)

        viewModel.canvasInvalidate.observe(viewLifecycleOwner) { rebuildLayerList() }
        viewModel.activeFrameIndex.observe(viewLifecycleOwner) { rebuildLayerList() }

        return scrollView
    }

    private fun rebuildLayerList() {
        listView.removeAllViews()
        val frame = viewModel.getActiveFrame() ?: return
        val activeIdx = frame.activeLayerIndex

        // Add layer button
        val addBtn = Button(requireContext()).apply {
            text = "+ Add Layer"
            setTextColor(Color.parseColor("#BD93F9"))
            setBackgroundColor(Color.parseColor("#2E2E4E"))
            setOnClickListener {
                viewModel.addLayer()
            }
        }
        listView.addView(addBtn, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 80
        ).apply { setMargins(4, 4, 4, 8) })

        for (i in frame.layers.indices.reversed()) {
            val layer = frame.layers[i]
            val row = createLayerRow(layer, i, i == activeIdx)
            listView.addView(row)
        }
    }

    private fun createLayerRow(layer: Layer, index: Int, isActive: Boolean): View {
        val row = LinearLayout(requireContext()).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(if (isActive) Color.parseColor("#44475A") else Color.parseColor("#2E2E4E"))
            setPadding(8, 4, 8, 4)
        }

        val visibilityBtn = ImageButton(requireContext()).apply {
            setImageResource(if (layer.isVisible) android.R.drawable.ic_menu_view else android.R.drawable.ic_menu_close_clear_cancel)
            setBackgroundColor(Color.TRANSPARENT)
            setColorFilter(Color.WHITE)
            setOnClickListener {
                layer.isVisible = !layer.isVisible
                viewModel.invalidateCanvas()
            }
        }

        val nameView = TextView(requireContext()).apply {
            text = layer.name
            setTextColor(Color.WHITE)
            textSize = 14f
            setPadding(8, 0, 0, 0)
            setOnClickListener { viewModel.setActiveLayer(index) }
        }

        val deleteBtn = ImageButton(requireContext()).apply {
            setImageResource(android.R.drawable.ic_menu_delete)
            setBackgroundColor(Color.TRANSPARENT)
            setColorFilter(Color.parseColor("#FF6B6B"))
            setOnClickListener {
                viewModel.removeLayer(index)
            }
        }

        row.addView(visibilityBtn, LinearLayout.LayoutParams(64, 64))
        row.addView(nameView, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
            gravity = android.view.Gravity.CENTER_VERTICAL
        })
        row.addView(deleteBtn, LinearLayout.LayoutParams(64, 64))

        row.setOnClickListener { viewModel.setActiveLayer(index) }

        val params = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 72)
        params.setMargins(4, 2, 4, 2)
        row.layoutParams = params
        return row
    }
}
