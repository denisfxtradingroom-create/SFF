package app.sff.signal;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import com.google.firebase.messaging.FirebaseMessaging;

/** In-app JS only requests the token; it is returned to our authenticated API. */
public final class SffTokenReceiver extends BroadcastReceiver {
  @Override public void onReceive(Context context, Intent intent) {
    if (intent == null || !Main.PUSH_REGISTER_ACTION.equals(intent.getAction())) return;
    FirebaseMessaging.getInstance().getToken()
      .addOnSuccessListener((token) -> {
        if (token == null || token.length() == 0) return;
        context.getSharedPreferences("sff_push",0)
          .edit().putString("fcm_token",token).apply();
        Main.deliverPushToken(token);
      });
  }
}
