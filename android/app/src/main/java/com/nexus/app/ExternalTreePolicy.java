package com.nexus.app;

public final class ExternalTreePolicy {
    private ExternalTreePolicy() {}

    public static final int MAX_FILES_PER_PASS = 100;
    public static final long MAX_VIDEO_BYTES = 100L * 1024L * 1024L;

    public static boolean isSupportedMime(String mime) {
        return mime != null && (mime.startsWith("image/") || mime.startsWith("video/"));
    }

    public static String key(String uri, long modified, long size) {
        return String.valueOf(uri) + ":" + modified + ":" + size;
    }
}
