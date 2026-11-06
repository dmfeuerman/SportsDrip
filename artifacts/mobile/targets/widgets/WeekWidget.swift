import SwiftUI
import WidgetKit

/// Small/medium widget: this week's H2H vs opponent, streak, Daily Pick status.
/// Reads the App Group snapshot the app writes (modules/live-activity setWidgetSnapshot).
struct WeekEntry: TimelineEntry {
  let date: Date
  let snap: WidgetSnapshot?
}

struct WeekProvider: TimelineProvider {
  func placeholder(in context: Context) -> WeekEntry { WeekEntry(date: .now, snap: nil) }
  func getSnapshot(in context: Context, completion: @escaping (WeekEntry) -> Void) {
    completion(WeekEntry(date: .now, snap: WidgetSnapshot.load()))
  }
  func getTimeline(in context: Context, completion: @escaping (Timeline<WeekEntry>) -> Void) {
    // The app calls WidgetCenter.reloadAllTimelines() on change; refresh hourly as a fallback.
    let entry = WeekEntry(date: .now, snap: WidgetSnapshot.load())
    completion(Timeline(entries: [entry], policy: .after(.now.addingTimeInterval(3600))))
  }
}

struct WeekWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "SportDripWeek", provider: WeekProvider()) { entry in
      WeekView(snap: entry.snap)
    }
    .configurationDisplayName("Your week")
    .description("H2H score, streak and today's Daily Pick.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}

private struct WeekView: View {
  let snap: WidgetSnapshot?
  var body: some View {
    if let s = snap {
      VStack(alignment: .leading, spacing: 4) {
        Text("vs \(s.opponent)").font(.caption)
        Text("\(s.h2hMe) – \(s.h2hThem)").font(.title2).bold()
        Text("🔥 \(s.streak)").font(.caption)
        Text(s.dailyPick == "picked" ? "Daily Pick ✓" : s.dailyPick == "open" ? "Daily Pick open" : "").font(.caption2)
      }
      .containerBackground(.fill.tertiary, for: .widget)
    } else {
      Text("Open SportDrip to set up").font(.caption).containerBackground(.fill.tertiary, for: .widget)
    }
  }
}
