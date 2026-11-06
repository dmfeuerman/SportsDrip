import SwiftUI
import WidgetKit

@main
struct SportDripWidgetBundle: WidgetBundle {
  var body: some Widget {
    WeekWidget()
    GameLiveActivity()
  }
}
