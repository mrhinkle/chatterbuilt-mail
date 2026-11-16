/** history.list answered 404. The stored historyId is no longer valid. */
export class HistoryExpired extends Error {
  constructor() {
    super("history expired");
    this.name = "HistoryExpired";
  }
}
