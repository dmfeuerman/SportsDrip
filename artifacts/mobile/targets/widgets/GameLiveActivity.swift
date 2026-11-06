import ActivityKit
import SwiftUI
import WidgetKit

/// One Live Activity per game with open bets: score, clock, your side, status,
/// cover margin and H2H delta. Started from the app on lock-in; updated by
/// direct APNs pushes from functions/src/lib/apns.ts (8 h max active).
struct GameLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: GameActivityAttributes.self) { context in
      LockScreenView(attrs: context.attributes, state: context.state)
        .padding()
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Text("\(context.attributes.awayAbbr) \(context.state.awayScore)").font(.headline)
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text("\(context.state.homeScore) \(context.attributes.homeAbbr)").font(.headline)
        }
        DynamicIslandExpandedRegion(.bottom) {
          HStack {
            Text(context.state.clock)
            Spacer()
            if let m = context.state.coverMargin { Text(m >= 0 ? "Covering +\(m, specifier: "%.1f")" : "Down \(m, specifier: "%.1f")") }
          }.font(.caption)
        }
      } compactLeading: {
        Text("\(context.state.awayScore)")
      } compactTrailing: {
        Text("\(context.state.homeScore)")
      } minimal: {
        Text("\(context.state.awayScore)-\(context.state.homeScore)").font(.caption2)
      }
    }
  }
}

private struct LockScreenView: View {
  let attrs: GameActivityAttributes
  let state: GameActivityAttributes.ContentState

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack {
        Text("\(attrs.awayAbbr) \(state.awayScore)").font(.title3).bold()
        Spacer()
        Text(state.status.uppercased()).font(.caption).padding(.horizontal, 6).padding(.vertical, 2)
          .background(Capsule().fill(state.status == "live" ? Color.red.opacity(0.25) : Color.gray.opacity(0.25)))
        Spacer()
        Text("\(state.homeScore) \(attrs.homeAbbr)").font(.title3).bold()
      }
      HStack {
        Text(state.clock).font(.caption)
        Spacer()
        Text("You: \(attrs.yourSide == "home" ? attrs.homeAbbr : attrs.awayAbbr)").font(.caption)
        if let m = state.coverMargin { Text(m >= 0 ? "+\(m, specifier: "%.1f")" : "\(m, specifier: "%.1f")").font(.caption) }
        if let d = state.h2hDelta { Text("H2H \(d >= 0 ? "+" : "")\(d)").font(.caption) }
      }
    }
  }
}
