/** State of the in-app dialogs that replace alert()/confirm() in the training flow. */

export interface TrainingDialogState {
  exitConfirmOpen: boolean;
  completion: { roleTitle: string } | null;
}

export type TrainingDialogAction =
  | { type: "request_exit" }
  | { type: "cancel_exit" }
  | { type: "finish"; roleTitle: string }
  | { type: "dismiss_completion" };

export const INITIAL_TRAINING_DIALOG: TrainingDialogState = { exitConfirmOpen: false, completion: null };

export function trainingDialogReducer(
  state: TrainingDialogState,
  action: TrainingDialogAction,
): TrainingDialogState {
  switch (action.type) {
    case "request_exit":
      return state.completion ? state : { ...state, exitConfirmOpen: true };
    case "cancel_exit":
      return { ...state, exitConfirmOpen: false };
    case "finish":
      return { exitConfirmOpen: false, completion: { roleTitle: action.roleTitle } };
    case "dismiss_completion":
      return { ...state, completion: null };
  }
}
