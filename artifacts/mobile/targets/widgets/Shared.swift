import ActivityKit
import Foundation

/// Must match modules/live-activity/ios/LiveActivityModule.swift (same struct, both targets).
/// Payloads stay well under ActivityKit's 4 KB limit; no promotional content.
struct GameActivityAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    var homeScore: Int
    var awayScore: Int
    var clock: String
    /// "live" | "final" | "delayed"
    var status: String
    /// Positive = your side is covering / ahead by this much.
    var coverMargin: Double?
    /// Your H2H matchup delta this week, in league tokens.
    var h2hDelta: Int?
  }

  var gameId: String
  var homeAbbr: String
  var awayAbbr: String
  /// "home" | "away"
  var yourSide: String
}

let appGroup = "group.com.dmfeuerman.mobile"
let widgetSnapshotKey = "sportdrip.widget.snapshot.v1"

struct WidgetSnapshot: Codable {
  var h2hMe: Int
  var h2hThem: Int
  var opponent: String
  var streak: Int
  /// "picked" | "open" | "none"
  var dailyPick: String
  var updatedAt: Double

  static func load() -> WidgetSnapshot? {
    guard let data = UserDefaults(suiteName: appGroup)?.data(forKey: widgetSnapshotKey) else { return nil }
    return try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
  }
}
