package app.sff.signal;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.RemoteInput;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.webkit.CookieManager;
import org.json.JSONObject;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Authenticated direct reply from a native SFF notification.
 * Uses the existing SFF WebView login cookie over HTTPS. Never copies user
 * credentials into FCM, Android notification extras or device preferences.
 */
public final class SffReplyReceiver extends BroadcastReceiver {
  static final String ACTION_REPLY = "app.sff.signal.NOTIFICATION_REPLY";
  static final String KEY_TEXT = "sff_inline_reply";
  static final String EXTRA_ROOM = "sff_dm_room";
  static final String EXTRA_NOTIFICATION = "sff_notification_id";

  static int notificationId(long room) {
    return (int)(30000L + Math.floorMod(room,100000L));
  }

  @Override public void onReceive(Context context, Intent intent) {
    if (intent == null || !ACTION_REPLY.equals(intent.getAction())) return;
    Bundle input = RemoteInput.getResultsFromIntent(intent);
    CharSequence reply = input == null ? null : input.getCharSequence(KEY_TEXT);
    final String text = reply == null ? "" : reply.toString().trim();
    final long room = intent.getLongExtra(EXTRA_ROOM,0L);
    final int id = intent.getIntExtra(EXTRA_NOTIFICATION,0);
    if (room < 1 || id != notificationId(room) || text.length() == 0 ||
        text.length() > 4000) return;
    final PendingResult pending = goAsync();
    Context app = context.getApplicationContext();
    new Thread(() -> {
      boolean delivered = false;
      try {
        final String origin = Main.DEFAULT_ORIGIN;
        if (origin == null || !origin.startsWith("https://"))
          throw new SecurityException("SFF requires HTTPS");
        // WebView's persisted cookie is scoped to the production SFF origin.
        // Server validates the session AND the recipient's DM room membership.
        String cookie = CookieManager.getInstance().getCookie(origin + "/");
        if (cookie == null || !cookie.matches("(?s).*(?:^|;\\s*)sff=[a-f0-9]{64}(?:;|$).*"))
          throw new SecurityException("No active SFF login");
        URL endpoint = new URL(origin + "/api/post");
        HttpURLConnection connection = (HttpURLConnection)endpoint.openConnection();
        try {
          connection.setRequestMethod("POST");
          connection.setInstanceFollowRedirects(false);
          connection.setConnectTimeout(8000);
          connection.setReadTimeout(8000);
          connection.setDoOutput(true);
          connection.setRequestProperty("Content-Type","application/json");
          connection.setRequestProperty("Origin",origin);
          connection.setRequestProperty("Cookie",cookie);
          byte[] payload = new JSONObject().put("room",room)
            .put("body",text).toString().getBytes(StandardCharsets.UTF_8);
          connection.setFixedLengthStreamingMode(payload.length);
          try (OutputStream stream = connection.getOutputStream()) {
            stream.write(payload);
          }
          delivered = connection.getResponseCode() >= 200 &&
            connection.getResponseCode() < 300;
        } finally {
          connection.disconnect();
        }
      } catch (Exception ignored) {
        // Failure is surfaced as an OS notification; do not claim a sent reply.
      } finally {
        try {
          NotificationManager manager = (NotificationManager)
            app.getSystemService(Context.NOTIFICATION_SERVICE);
          Intent open = new Intent(app,Main.class)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK |
                      Intent.FLAG_ACTIVITY_CLEAR_TOP |
                      Intent.FLAG_ACTIVITY_SINGLE_TOP);
          PendingIntent tap = PendingIntent.getActivity(app,id,open,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
          String title = delivered ? "SFF · Odgovor poslat" : "SFF · Odgovor nije poslat";
          String body = delivered ? "Poruka je uspešno poslata." :
            "Otvori SFF i proveri prijavu ili internet vezu.";
          Notification notice = new Notification.Builder(
            app,SffMessagingService.MESSAGE_CHANNEL)
            .setSmallIcon(R.drawable.mark)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setContentIntent(tap)
            .setPriority(delivered ? Notification.PRIORITY_LOW : Notification.PRIORITY_HIGH)
            .setTimeoutAfter(delivered ? 6000L : 30000L)
            .build();
          manager.notify(id,notice);
        } catch (Exception ignored) {}
        pending.finish();
      }
    },"sff-inline-reply").start();
  }
}
