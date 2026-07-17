package com.nexus.app;

public final class ExternalTreePolicy {
    private ExternalTreePolicy() {}

    public static final int MAX_FILES_PER_PASS = 100;
    public static final long MAX_VIDEO_BYTES = 1024L * 1024L * 1024L;

    public static boolean isSupportedBackupFile(String name, String mime) {
        String n = name != null ? name.toLowerCase() : "";
        String m = mime != null ? mime.toLowerCase() : "";
        if (m.startsWith("image/") || m.startsWith("video/")) return true;
        if (m.equals("application/zip") || m.equals("application/octet-stream")) return true;
        return n.endsWith(".crypt12") || n.endsWith(".crypt14") || n.endsWith(".crypt15") ||
            n.endsWith(".db") || n.endsWith(".db.crypt12") || n.endsWith(".db.crypt14") ||
            n.endsWith(".db.crypt15") || n.endsWith(".zip") || n.endsWith(".txt") ||
            n.endsWith(".json") || n.endsWith(".vcf");
    }

    public static String key(String uri, long modified, long size) {
        return String.valueOf(uri) + ":" + modified + ":" + size;
    }
}
