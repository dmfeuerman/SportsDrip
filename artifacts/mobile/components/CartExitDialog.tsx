import React from "react";
import { ChoiceDialog } from "@/components/ui";
import { useCartItems } from "@/hooks/useCartItems";

const listNames = (names: string[]) => {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length <= 4) return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
};

/**
 * The one "you have items in your cart" popup, shown when leaving the Drip
 * Shop or the character creator with something in the cart.
 */
export default function CartExitDialog({
  visible,
  onCheckout,
  onLeave,
  onCancel,
}: {
  visible: boolean;
  onCheckout: () => void;
  onLeave: () => void;
  onCancel: () => void;
}) {
  const { items, count, total } = useCartItems();
  const one = count === 1;
  return (
    <ChoiceDialog
      visible={visible && count > 0}
      title={`${count} ${one ? "item" : "items"} in your cart`}
      body={`${listNames(items.map((i) => i.name))} ${one ? "is" : "are"} in your cart. Check out now, or leave and ${one ? "it stays" : "they stay"} in your cart until you clear ${one ? "it" : "them"} at checkout.`}
      actions={[
        { label: `Checkout · ${total.toLocaleString()}`, icon: "cart", onPress: onCheckout },
        { label: "Leave for now", variant: "secondary", onPress: onLeave },
      ]}
      cancelLabel="Cancel"
      onCancel={onCancel}
    />
  );
}
