package com.iledger.nativeapp

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.espresso.Espresso
import androidx.test.platform.app.InstrumentationRegistry
import android.graphics.Bitmap
import android.os.ParcelFileDescriptor
import java.io.File
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue

class NavigationTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private fun screenshot(name: String) {
        compose.waitForIdle()
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        val directory=File(instrumentation.targetContext.getExternalFilesDir(null),"screenshots")
        check(directory.mkdirs() || directory.isDirectory)
        val bitmap=requireNotNull(instrumentation.uiAutomation.takeScreenshot())
        val output=File(directory,"$name.png")
        try { output.outputStream().use { check(bitmap.compress(Bitmap.CompressFormat.PNG,100,it)) } }
        finally { bitmap.recycle() }
        // UTP uninstalls the test app; retain only its screenshots outside app data.
        for(command in listOf("mkdir -p /sdcard/Download/iledger-native-screenshots", "cp ${output.absolutePath} /sdcard/Download/iledger-native-screenshots/$name.png")) {
            ParcelFileDescriptor.AutoCloseInputStream(instrumentation.uiAutomation.executeShellCommand(command)).use { it.readBytes() }
        }
    }
    @Test fun systemBackPopsInnerFormBeforeOuterForm() {
        compose.onNodeWithContentDescription("新增支出").performClick()
        compose.onNodeWithTag("editor-transactions").assertIsDisplayed()
        compose.onNodeWithContentDescription("新建类别").performScrollTo().performClick()
        compose.onNodeWithTag("editor-categories").assertIsDisplayed()
        screenshot("nested-category")
        Espresso.pressBack()
        compose.onNodeWithTag("editor-categories").assertDoesNotExist()
        compose.onNodeWithTag("editor-transactions").assertIsDisplayed()
        Espresso.pressBack()
        compose.onNodeWithTag("editor-transactions").assertDoesNotExist()
        compose.onNodeWithTag("dashboard-grid").assertIsDisplayed()
        screenshot("back-to-dashboard")
    }
    @Test fun ordinaryPortraitShowsTwoSmallTiles() {
        compose.onNodeWithTag("dashboard-grid").assertIsDisplayed()
        val config=compose.activity.resources.configuration
        assertTrue("This test requires a normal-width portrait device",config.screenWidthDp >= 340 && config.fontScale <= 1.5f)
        val income=compose.onNodeWithText("总收入").fetchSemanticsNode().boundsInRoot
        val expense=compose.onNodeWithText("总支出").fetchSemanticsNode().boundsInRoot
        assertEquals(income.top,expense.top,1f)
        screenshot("portrait-dashboard")
    }
    @Test fun draftSurvivesActivityRecreation() {
        compose.onNodeWithContentDescription("新增支出").performClick()
        compose.onNode(hasText("项目名称") and hasSetTextAction()).performTextInput("重建测试草稿")
        compose.activityRule.scenario.recreate()
        compose.onNodeWithTag("editor-transactions").assertIsDisplayed()
        compose.onNode(hasText("项目名称") and hasSetTextAction()).assertTextContains("重建测试草稿")
        screenshot("restored-draft")
    }
    @Test fun installedVersionMatchesBuildDefinition() {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val installed=context.packageManager.getPackageInfo(context.packageName,0)
        assertEquals(BuildConfig.VERSION_NAME,installed.versionName)
        assertEquals(BuildConfig.VERSION_CODE.toLong(),installed.longVersionCode)
    }
}
