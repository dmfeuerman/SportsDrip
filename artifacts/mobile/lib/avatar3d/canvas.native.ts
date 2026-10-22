// Metro picks this file on iOS and Android. R3F's native entry wires the
// expo-gl context and the RN event system; the web entry would reach for a
// DOM canvas and crash on mount.
export { Canvas } from "@react-three/fiber/native";
