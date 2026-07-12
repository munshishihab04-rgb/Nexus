package com.nexus.app;

import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.os.Build;

public final class RecoveryScheduler {
    private static final int JOB_ID = 0x4e5853;
    private RecoveryScheduler() {}

    public static void schedule(Context context) {
        JobScheduler scheduler = (JobScheduler) context.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (scheduler == null) return;
        JobInfo.Builder builder = new JobInfo.Builder(JOB_ID,
            new ComponentName(context, NexusRecoveryJobService.class))
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setPersisted(true)
            .setPeriodic(RecoverySchedule.PERIOD_MS);
        scheduler.schedule(builder.build());
    }
}
