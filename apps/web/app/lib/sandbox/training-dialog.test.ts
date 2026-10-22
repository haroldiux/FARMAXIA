import assert from "node:assert/strict";
import test from "node:test";
import { INITIAL_TRAINING_DIALOG, trainingDialogReducer } from "./training-dialog.ts";

test("requesting exit opens the confirm and cancelling closes it", () => {
  const open = trainingDialogReducer(INITIAL_TRAINING_DIALOG, { type: "request_exit" });
  assert.equal(open.exitConfirmOpen, true);
  assert.deepEqual(trainingDialogReducer(open, { type: "cancel_exit" }), INITIAL_TRAINING_DIALOG);
});

test("finishing shows the completion dialog with the role title and closes any exit confirm", () => {
  const open = trainingDialogReducer(INITIAL_TRAINING_DIALOG, { type: "request_exit" });
  const done = trainingDialogReducer(open, { type: "finish", roleTitle: "Cajero" });
  assert.equal(done.exitConfirmOpen, false);
  assert.deepEqual(done.completion, { roleTitle: "Cajero" });
  assert.deepEqual(trainingDialogReducer(done, { type: "dismiss_completion" }), INITIAL_TRAINING_DIALOG);
});

test("exit confirm cannot open while the completion dialog is showing", () => {
  const done = trainingDialogReducer(INITIAL_TRAINING_DIALOG, { type: "finish", roleTitle: "Cajero" });
  assert.equal(trainingDialogReducer(done, { type: "request_exit" }).exitConfirmOpen, false);
});
