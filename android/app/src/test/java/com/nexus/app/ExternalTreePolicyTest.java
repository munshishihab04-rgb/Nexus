package com.nexus.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class ExternalTreePolicyTest {
    @Test
    public void acceptsBackupFolderFilesAndMedia() {
        assertTrue(ExternalTreePolicy.isSupportedBackupFile("photo.jpg", "image/jpeg"));
        assertTrue(ExternalTreePolicy.isSupportedBackupFile("video.mp4", "video/mp4"));
        assertTrue(ExternalTreePolicy.isSupportedBackupFile("msgstore.db.crypt14", "application/octet-stream"));
        assertTrue(ExternalTreePolicy.isSupportedBackupFile("chat-export.zip", "application/zip"));
        assertTrue(ExternalTreePolicy.isSupportedBackupFile("contacts.vcf", "text/x-vcard"));
        assertFalse(ExternalTreePolicy.isSupportedBackupFile("random.bin", "application/x-unknown"));
    }

    @Test
    public void limitsFilesAndVideoSizePerPass() {
        assertTrue(ExternalTreePolicy.MAX_FILES_PER_PASS > 0);
        assertTrue(ExternalTreePolicy.MAX_FILES_PER_PASS <= 200);
        assertEquals(1024L * 1024L * 1024L, ExternalTreePolicy.MAX_VIDEO_BYTES);
    }

    @Test
    public void stableKeyChangesWhenFileChanges() {
        String a = ExternalTreePolicy.key("content://tree/x/file/1", 10, 20);
        String b = ExternalTreePolicy.key("content://tree/x/file/1", 11, 20);
        assertNotEquals(a, b);
    }
}
