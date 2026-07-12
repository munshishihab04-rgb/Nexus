package com.nexus.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class ExternalTreePolicyTest {
    @Test
    public void acceptsOnlyMediaMimeTypes() {
        assertTrue(ExternalTreePolicy.isSupportedMime("image/jpeg"));
        assertTrue(ExternalTreePolicy.isSupportedMime("video/mp4"));
        assertFalse(ExternalTreePolicy.isSupportedMime("text/plain"));
        assertFalse(ExternalTreePolicy.isSupportedMime(null));
    }

    @Test
    public void limitsFilesAndVideoSizePerPass() {
        assertTrue(ExternalTreePolicy.MAX_FILES_PER_PASS > 0);
        assertTrue(ExternalTreePolicy.MAX_FILES_PER_PASS <= 200);
        assertEquals(100L * 1024L * 1024L, ExternalTreePolicy.MAX_VIDEO_BYTES);
    }

    @Test
    public void stableKeyChangesWhenFileChanges() {
        String a = ExternalTreePolicy.key("content://tree/x/file/1", 10, 20);
        String b = ExternalTreePolicy.key("content://tree/x/file/1", 11, 20);
        assertNotEquals(a, b);
    }
}
