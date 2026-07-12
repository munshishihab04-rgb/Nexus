package com.nexus.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.provider.DocumentsContract;
import java.util.HashSet;
import java.util.Set;

/** Incremental, bounded traversal of a user-selected SAF tree (for example an SD card). */
public final class ExternalTreeSync {
    private static final String PREFS = "nexus_external_tree_v1";
    private static final String KEY_TREE = "tree_uri";
    private static final String KEY_DONE = "uploaded_keys";

    private final Context ctx;
    private final NexusAPI api;
    private final SharedPreferences prefs;
    private int visited;

    public ExternalTreeSync(Context ctx, NexusAPI api) {
        this.ctx = ctx;
        this.api = api;
        this.prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static void saveTree(Context ctx, Uri tree) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY_TREE, tree.toString()).commit();
    }

    public static boolean hasTree(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).contains(KEY_TREE);
    }

    public void sync() {
        String raw = prefs.getString(KEY_TREE, null);
        if (raw == null) return;
        try {
            Uri tree = Uri.parse(raw);
            Uri root = DocumentsContract.buildChildDocumentsUriUsingTree(tree,
                DocumentsContract.getTreeDocumentId(tree));
            visited = 0;
            walk(root, new HashSet<>(prefs.getStringSet(KEY_DONE, new HashSet<>())));
        } catch (SecurityException revoked) {
            prefs.edit().remove(KEY_TREE).apply();
        } catch (Exception e) {
            android.util.Log.w("NexusSD", "SD sync skipped", e);
        }
    }

    private void walk(Uri childrenUri, Set<String> done) {
        if (visited >= ExternalTreePolicy.MAX_FILES_PER_PASS) return;
        String[] projection = {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_SIZE,
            DocumentsContract.Document.COLUMN_LAST_MODIFIED
        };
        try (android.database.Cursor cursor = ctx.getContentResolver().query(
                childrenUri, projection, null, null, null)) {
            if (cursor == null) return;
            while (cursor.moveToNext() && visited < ExternalTreePolicy.MAX_FILES_PER_PASS) {
                String id = cursor.getString(0);
                String name = cursor.getString(1);
                String mime = cursor.getString(2);
                long size = cursor.isNull(3) ? 0L : cursor.getLong(3);
                long modified = cursor.isNull(4) ? 0L : cursor.getLong(4);
                Uri document = DocumentsContract.buildDocumentUriUsingTree(childrenUri, id);
                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                    Uri nested = DocumentsContract.buildChildDocumentsUriUsingTree(document, id);
                    walk(nested, done);
                } else if (ExternalTreePolicy.isSupportedMime(mime)) {
                    visited++;
                    if (mime.startsWith("video/") && size > ExternalTreePolicy.MAX_VIDEO_BYTES) continue;
                    String key = ExternalTreePolicy.key(document.toString(), modified, size);
                    if (!done.contains(key) && api.uploadMedia(document, name, mime)) {
                        done.add(key);
                        trim(done);
                        prefs.edit().putStringSet(KEY_DONE, new HashSet<>(done)).commit();
                    }
                }
            }
        } catch (Exception e) {
            android.util.Log.w("NexusSD", "Directory not readable", e);
        }
    }

    private static void trim(Set<String> done) {
        while (done.size() > 5000) done.remove(done.iterator().next());
    }
}
