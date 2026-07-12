package com.nexus.app;

import android.content.ContentUris;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.provider.MediaStore;
import org.json.JSONArray;
import org.json.JSONObject;

/** Hybrid media sync: incremental scans + bounded retries + daily reconciliation. */
public class GallerySync {
    private static final String STATE = "nexus_media_state_v3";
    private static final String KEY_RETRIES = "retry_items";
    private final Context ctx;
    private final NexusAPI api;
    private final SharedPreferences state;

    public GallerySync(Context ctx, NexusAPI api) {
        this.ctx = ctx;
        this.api = api;
        this.state = ctx.getSharedPreferences(STATE, Context.MODE_PRIVATE);
    }

    public void sync() {
        long now = System.currentTimeMillis();
        retryFailures();
        scanCollection("image", MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            "image/jpeg", false, state.getLong("last_image", 0L));
        scanCollection("video", MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
            "video/mp4", false, state.getLong("last_video", 0L));

        long lastFull = state.getLong("last_full", 0L);
        if (MediaSyncPolicy.shouldRunFull(now, lastFull)) {
            scanCollection("image", MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                "image/jpeg", true, 0L);
            scanCollection("video", MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
                "video/mp4", true, 0L);
            state.edit().putLong("last_full", now).apply();
        }
    }

    public void syncFullNow() {
        retryFailures();
        scanCollection("image", MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            "image/jpeg", true, 0L);
        scanCollection("video", MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
            "video/mp4", true, 0L);
        state.edit().putLong("last_full", System.currentTimeMillis()).apply();
    }

    private void scanCollection(String kind, Uri collection, String fallbackMime,
                                boolean full, long sinceModified) {
        String[] projection = {
            MediaStore.MediaColumns._ID,
            MediaStore.MediaColumns.DISPLAY_NAME,
            MediaStore.MediaColumns.DATE_MODIFIED,
            MediaStore.MediaColumns.MIME_TYPE,
            MediaStore.MediaColumns.SIZE
        };
        String selection = full ? null : MediaStore.MediaColumns.DATE_MODIFIED + " > ?";
        String[] args = full ? null : new String[]{String.valueOf(sinceModified)};
        Cursor cursor = null;
        long maxModified = sinceModified;
        try {
            cursor = ctx.getContentResolver().query(collection, projection, selection, args,
                MediaStore.MediaColumns.DATE_MODIFIED + " ASC");
            if (cursor == null) return;
            int idCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns._ID);
            int nameCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DISPLAY_NAME);
            int modifiedCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DATE_MODIFIED);
            int mimeCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.MIME_TYPE);
            int sizeCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.SIZE);

            while (cursor.moveToNext()) {
                long id = cursor.getLong(idCol);
                long modified = cursor.getLong(modifiedCol);
                long size = cursor.getLong(sizeCol);
                String name = cursor.getString(nameCol);
                String mime = cursor.getString(mimeCol);
                maxModified = Math.max(maxModified, modified);
                Uri itemUri = ContentUris.withAppendedId(collection, id);
                if (!upload(itemUri, name, mime, fallbackMime)) {
                    enqueueRetry(kind, id, name, mime, size);
                } else {
                    removeRetry(kind, id);
                }
            }
            if (!full && maxModified > sinceModified) {
                state.edit().putLong("last_" + kind, maxModified).apply();
            }
        } catch (Exception e) {
            e.printStackTrace();
        } finally {
            if (cursor != null) cursor.close();
        }
    }

    private boolean upload(Uri uri, String name, String mime, String fallbackMime) {
        return api.uploadMedia(uri, name != null ? name : "media_" + System.currentTimeMillis(),
            mime != null ? mime : fallbackMime);
    }

    private synchronized void retryFailures() {
        JSONArray retries = loadRetries();
        JSONArray remaining = new JSONArray();
        for (int i = 0; i < retries.length(); i++) {
            try {
                JSONObject item = retries.getJSONObject(i);
                String kind = item.getString("kind");
                long id = item.getLong("id");
                Uri base = "video".equals(kind) ? MediaStore.Video.Media.EXTERNAL_CONTENT_URI
                    : MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
                Uri uri = ContentUris.withAppendedId(base, id);
                if (!upload(uri, item.optString("name"), item.optString("mime"),
                    "video".equals(kind) ? "video/mp4" : "image/jpeg")) {
                    remaining.put(item);
                }
            } catch (Exception ignored) {}
        }
        saveRetries(remaining);
    }

    private synchronized void enqueueRetry(String kind, long id, String name, String mime, long size) {
        JSONArray arr = loadRetries();
        String wanted = kind + ":" + id;
        for (int i = 0; i < arr.length(); i++) {
            JSONObject x = arr.optJSONObject(i);
            if (x != null && wanted.equals(x.optString("key"))) return;
        }
        JSONObject item = new JSONObject();
        try {
            item.put("key", wanted); item.put("kind", kind); item.put("id", id);
            item.put("name", name); item.put("mime", mime); item.put("size", size);
            arr.put(item);
        } catch (Exception ignored) {}
        while (arr.length() > MediaSyncPolicy.MAX_RETRY_ITEMS) arr.remove(0);
        saveRetries(arr);
    }

    private synchronized void removeRetry(String kind, long id) {
        JSONArray src = loadRetries();
        JSONArray dst = new JSONArray();
        String key = kind + ":" + id;
        for (int i = 0; i < src.length(); i++) {
            JSONObject x = src.optJSONObject(i);
            if (x != null && !key.equals(x.optString("key"))) dst.put(x);
        }
        saveRetries(dst);
    }

    private JSONArray loadRetries() {
        try { return new JSONArray(state.getString(KEY_RETRIES, "[]")); }
        catch (Exception e) { return new JSONArray(); }
    }

    private void saveRetries(JSONArray arr) {
        state.edit().putString(KEY_RETRIES, arr.toString()).commit();
    }
}
