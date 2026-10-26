"use client";

import { useSyncExternalStore } from "react";
import { Laptop, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const ICON_SIZE = 16;

// Hydration status needs no external event subscription.
function subscribe() {
  return () => {};
}

function getClientSnapshot() {
  return true;
}

function getServerSnapshot() {
  return false;
}

function ThemeSwitcher() {
  const mounted = useSyncExternalStore(
    subscribe,
    getClientSnapshot,
    getServerSnapshot,
  );

  const { theme, setTheme } = useTheme();

  if (!mounted) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Change colour theme"
        >
          {theme === "light" ? (
            <Sun
              size={ICON_SIZE}
              className="text-muted-foreground"
              aria-hidden="true"
            />
          ) : theme === "dark" ? (
            <Moon
              size={ICON_SIZE}
              className="text-muted-foreground"
              aria-hidden="true"
            />
          ) : (
            <Laptop
              size={ICON_SIZE}
              className="text-muted-foreground"
              aria-hidden="true"
            />
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent className="w-40" align="start">
        <DropdownMenuRadioGroup
          value={theme ?? "system"}
          onValueChange={setTheme}
          aria-label="Colour theme"
        >
          <DropdownMenuRadioItem
            className="flex gap-2"
            value="light"
          >
            <Sun
              size={ICON_SIZE}
              className="text-muted-foreground"
              aria-hidden="true"
            />
            <span>Light</span>
          </DropdownMenuRadioItem>

          <DropdownMenuRadioItem
            className="flex gap-2"
            value="dark"
          >
            <Moon
              size={ICON_SIZE}
              className="text-muted-foreground"
              aria-hidden="true"
            />
            <span>Dark</span>
          </DropdownMenuRadioItem>

          <DropdownMenuRadioItem
            className="flex gap-2"
            value="system"
          >
            <Laptop
              size={ICON_SIZE}
              className="text-muted-foreground"
              aria-hidden="true"
            />
            <span>System</span>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export { ThemeSwitcher };