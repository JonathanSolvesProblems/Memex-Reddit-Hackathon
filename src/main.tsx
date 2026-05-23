import { Devvit } from "@devvit/public-api";
import { appSettings } from "./settings.js";
import { registerMenu } from "./menu.js";
import { MemexPost } from "./post.js";
import { runWeeklyDigest } from "./calibration/digest.js";
import {
  onAppInstallOrUpgrade,
  onCommentSubmit,
  onConclaveSweep,
  onConclaveTimeout,
  onModActionEvent,
  onModMailReceived,
  onPostSubmit,
} from "./triggers.js";

Devvit.configure({
  redditAPI: true,
  redis: true,
  realtime: false,
  http: false,
});

Devvit.addSettings(appSettings);

Devvit.addCustomPostType({
  name: "Memex",
  description: "Your mod team's memory: decision rooms, precedent recall, and a living rulebook",
  height: "tall",
  render: MemexPost,
});

Devvit.addTrigger({ event: "PostSubmit", onEvent: onPostSubmit });
Devvit.addTrigger({ event: "CommentSubmit", onEvent: onCommentSubmit });
Devvit.addTrigger({ event: "ModAction", onEvent: onModActionEvent });
Devvit.addTrigger({ event: "ModMail", onEvent: onModMailReceived });
Devvit.addTrigger({
  events: ["AppInstall", "AppUpgrade"],
  onEvent: onAppInstallOrUpgrade,
});

Devvit.addSchedulerJob({
  name: "conclaveTimeout",
  onRun: onConclaveTimeout,
});

Devvit.addSchedulerJob({
  name: "conclaveSweep",
  onRun: onConclaveSweep,
});

Devvit.addSchedulerJob({
  name: "weeklyCalibrationDigest",
  onRun: runWeeklyDigest,
});

registerMenu();

export default Devvit;
