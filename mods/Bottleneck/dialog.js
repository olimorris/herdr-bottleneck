import { focused, props, setShared, openOverlay, closeOverlay } from "herdr";
import { DIALOG } from "./store.js";

// The review tab leaves the keyboard alone while one is open, and it closes when you switch away from its tab.
export class Dialog {
  constructor(tab, cx) {
    setShared(DIALOG, true);
    this.handle = cx.focus_handle();
    // Herdr's dialogs belong to the window, not a tab: left open, one would sit over every other tab.
    if (tab) cx.timer.every(300, () => { if (!this.leaving && focused()?.tab && focused().tab !== tab) { this.leaving = true; this.dismiss(); } });
  }

  dismiss() {
    closeOverlay(props().overlay);
  }

  // Swapping one dialog for another, the old one's close comes after the new one opens and mustn't hand the tab back the keyboard.
  handOff(overlay) {
    this.handingOff = true;
    openOverlay(overlay);
    this.dismiss();
  }

  close() {
    if (!this.handingOff) setShared(DIALOG, false);
  }
}
