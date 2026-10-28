import React, { useId } from "react";
import {
  InputAccessoryView,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from "react-native";
import { useColors } from "@/hooks/useColors";

/** TextInput for number/decimal pads. iOS pads have no return key, so attach a Done bar. */
const NumericInput = React.forwardRef<React.ComponentRef<typeof TextInput>, TextInputProps>(function NumericInput(props, ref) {
  const c = useColors();
  const accessoryId = `numeric-done-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const ios = Platform.OS === "ios";

  return (
    <>
      <TextInput
        ref={ref}
        keyboardType="number-pad"
        returnKeyType="done"
        inputAccessoryViewID={ios ? accessoryId : undefined}
        {...props}
      />
      {ios && (
        <InputAccessoryView nativeID={accessoryId}>
          <View style={[styles.bar, { backgroundColor: c.elevated, borderTopColor: c.border }]}>
            <Pressable accessibilityRole="button" accessibilityLabel="Done" onPress={Keyboard.dismiss} hitSlop={8}>
              <Text style={[styles.done, { color: c.primary }]}>Done</Text>
            </Pressable>
          </View>
        </InputAccessoryView>
      )}
    </>
  );
});

export default NumericInput;

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  done: { fontSize: 16, fontWeight: "600" },
});
