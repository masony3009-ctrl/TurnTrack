import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { useProfile } from "../../components/ProfileProvider";
import { useSupplies } from "../../components/useSupplies";
import { colors } from "../../theme";

export default function TabsLayout() {
  const { state } = useProfile();
  const isOwner = state.status === "owner";
  const supplies = useSupplies(isOwner);
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.teal,
        tabBarInactiveTintColor: colors.faint,
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.line },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Jobs",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "home" : "home-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: "Calendar",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "calendar" : "calendar-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="houses"
        options={{
          title: "Houses",
          href: isOwner ? undefined : null,
          // How many houses have supplies waiting to be restocked.
          tabBarBadge: isOwner && supplies.length ? supplies.length : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.gold, color: colors.dark, fontSize: 11, fontWeight: "700" },
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "business" : "business-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="team"
        options={{
          title: "Team",
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? "people" : "people-outline"} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="payroll"
        options={{
          // Cleaners get their own pay here; the owner gets everyone's.
          title: isOwner ? "Payroll" : "My pay",
          href: isOwner || state.status === "cleaner" ? undefined : null,
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={isOwner ? (focused ? "cash" : "cash-outline") : focused ? "wallet" : "wallet-outline"} size={22} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
