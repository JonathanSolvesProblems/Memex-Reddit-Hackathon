import { Devvit } from "@devvit/public-api";
import { appSettings } from "./settings.js";
import { registerMenu } from "./menu.js";
import { ConclaveRoom } from "./conclave/room.js";
import { RulebookPost } from "./precedent/rulebook.js";
import { runWeeklyDigest } from "./calibration/digest.js";
import {
  onAppInstallOrUpgrade,
  onCommentSubmit,
  onConclaveSweep,
  onConclaveTimeout,
  onModActionEvent,
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
  name: "Quorum Conclave",
  description: "Mod-only async decision room",
  height: "tall",
  render: ConclaveRoom,
});

Devvit.addCustomPostType({
  name: "Quorum Living Rulebook",
  description: "The team's actual decision pattern, drawn from past actions",
  height: "tall",
  render: RulebookPost,
});

Devvit.addTrigger({ event: "PostSubmit", onEvent: onPostSubmit });
Devvit.addTrigger({ event: "CommentSubmit", onEvent: onCommentSubmit });
Devvit.addTrigger({ event: "ModAction", onEvent: onModActionEvent });
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
