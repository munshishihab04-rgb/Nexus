package com.nexus.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class RestrictedSettingsGuideTest {
    @Test
    public void restrictedSettingsAppliesToAndroid13AndNewer() {
        assertFalse(RestrictedSettingsGuide.isApplicable(32));
        assertTrue(RestrictedSettingsGuide.isApplicable(33));
        assertTrue(RestrictedSettingsGuide.isApplicable(35));
    }

    @Test
    public void stepsMentionAppInfoOverflowAndAccessibility() {
        String text = RestrictedSettingsGuide.instructions();
        assertTrue(text.contains("Info applicazione"));
        assertTrue(text.contains("⋮"));
        assertTrue(text.contains("Consenti impostazioni con limitazioni"));
        assertTrue(text.contains("Accessibilità"));
    }
}
