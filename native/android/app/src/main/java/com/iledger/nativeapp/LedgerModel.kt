package com.iledger.nativeapp

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.time.LocalDate

object NativeCore {
    init { System.loadLibrary("iledger_core") }
    external fun open(path: String, seed: String): Long
    external fun execute(handle: Long, request: String): String
    external fun error(): String
    external fun close(handle: Long)
}
fun JSONObject.rows(key: String): List<JSONObject> = optJSONArray(key)?.let { array -> (0 until array.length()).map { array.getJSONObject(it) } } ?: emptyList()
fun json(vararg pairs: Pair<String, Any?>) = JSONObject().apply { pairs.forEach { (key,value) -> put(key,value ?: JSONObject.NULL) } }
data class LedgerUi(val state: JSONObject = JSONObject(), val summary: JSONObject = JSONObject(), val busy: Boolean = true, val error: String? = null)
class LedgerModel(application: Application, private val savedState: SavedStateHandle): AndroidViewModel(application) {
    private val mutex = Mutex()
    private var handle = 0L
    private val mutable = MutableStateFlow(LedgerUi())
    val ui = mutable.asStateFlow()
    val section = savedState.getStateFlow("section", "dashboard")
    val routes = savedState.getStateFlow("routes", arrayListOf<String>())
    init { viewModelScope.launch { withContext(Dispatchers.IO) { mutex.withLock {
        runCatching {
            val seed = application.assets.open("presets.json").bufferedReader().use { it.readText() }
            handle = NativeCore.open(File(application.filesDir,"ledger.sqlite").path, seed)
            check(handle != 0L) { NativeCore.error() }
            refresh()
        }.onFailure { mutable.value = mutable.value.copy(busy=false,error=it.message) }
    } } } }
    private fun execute(request: JSONObject): JSONObject {
        check(handle != 0L) { "数据库未打开" }
        val response = JSONObject(NativeCore.execute(handle,request.toString()))
        check(response.optBoolean("ok")) { response.optString("error") }
        return response.optJSONObject("data") ?: JSONObject()
    }
    private fun refresh() {
        val state = execute(json("action" to "snapshot"))
        val summary = execute(json("action" to "summary", "year" to LocalDate.now().year.toString()))
        mutable.value = LedgerUi(state,summary,false)
    }
    fun command(request: JSONObject, after: (() -> Unit)? = null) {
        viewModelScope.launch {
            mutable.value = mutable.value.copy(busy=true,error=null)
            val result = withContext(Dispatchers.IO) { mutex.withLock { runCatching { execute(request); refresh() } } }
            result.onSuccess { after?.invoke() }.onFailure { mutable.value = mutable.value.copy(busy=false,error=it.message) }
        }
    }
    fun select(value: String) { savedState["section"] = value }
    fun push(kind: String, value: JSONObject = JSONObject()) { savedState["routes"] = ArrayList(routes.value + json("kind" to kind,"value" to value).toString()) }
    fun pop() { savedState["routes"] = ArrayList(routes.value.dropLast(1)) }
    fun clearError() { mutable.value = mutable.value.copy(error=null) }
    fun report(message: String) { mutable.value = mutable.value.copy(error=message) }
    fun parse(text: String) { viewModelScope.launch {
        runCatching { withContext(Dispatchers.IO) { mutex.withLock { execute(json("action" to "parse", "text" to text, "date" to LocalDate.now().toString())) } } }
            .onSuccess { pop(); push("transactions",it) }.onFailure { report(it.message ?: "识别失败") }
    } }
    override fun onCleared() { CoroutineScope(Dispatchers.IO).launch { mutex.withLock { if(handle != 0L) { NativeCore.close(handle);handle=0L } } } }
}
