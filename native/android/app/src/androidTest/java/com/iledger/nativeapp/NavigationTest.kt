package com.iledger.nativeapp

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.espresso.Espresso
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.assertEquals

class NavigationTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    @Test fun systemBackPopsInnerFormBeforeOuterForm() {
        compose.onNodeWithContentDescription("新增支出").performClick()
        compose.onNodeWithTag("editor-transactions").assertIsDisplayed()
        compose.onNodeWithContentDescription("新建类别").performScrollTo().performClick()
        compose.onNodeWithTag("editor-categories").assertIsDisplayed()
        Espresso.pressBack()
        compose.onNodeWithTag("editor-categories").assertDoesNotExist()
        compose.onNodeWithTag("editor-transactions").assertIsDisplayed()
        Espresso.pressBack()
        compose.onNodeWithTag("editor-transactions").assertDoesNotExist()
        compose.onNodeWithTag("dashboard-grid").assertIsDisplayed()
    }
    @Test fun ordinaryPortraitShowsTwoSmallTiles() {
        val config=compose.activity.resources.configuration
        if(config.screenWidthDp >= 340 && config.fontScale <= 1.5f) {
            val income=compose.onNodeWithText("总收入").fetchSemanticsNode().boundsInRoot
            val expense=compose.onNodeWithText("总支出").fetchSemanticsNode().boundsInRoot
            assertEquals(income.top,expense.top,1f)
        }
    }
}
