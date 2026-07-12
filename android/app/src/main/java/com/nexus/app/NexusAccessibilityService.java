package com.nexus.app;

import android.accessibilityservice.AccessibilityService;
import android.view.accessibility.AccessibilityEvent;

/**
 * User-enabled accessibility integration. It deliberately does not collect typed
 * text, passwords, clipboard contents, or browser content.
 */
public class NexusAccessibilityService extends AccessibilityService {
    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        // Reserved for an explicit, user-visible assistive feature.
    }

    @Override
    public void onInterrupt() {
        // No buffered personal data.
    }
}
