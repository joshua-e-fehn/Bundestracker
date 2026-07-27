"use client"

import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react"
import { useTheme } from "next-themes"
import { useEffect, useState } from "react"
import { useLocale } from "@/components/providers/locale-provider"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { TranslationKey } from "@/lib/i18n"

/**
 * Light / dark / system, as a menu rather than a two-way switch.
 *
 * A switch cannot express three states, and "system" has to remain reachable:
 * the site defaults to light (components/providers/theme-provider.tsx), so a
 * reader whose OS is dark has no other way back to following it.
 */
const THEMES: ReadonlyArray<{
  value: string
  labelKey: TranslationKey
  Icon: typeof SunIcon
}> = [
  { value: "light", labelKey: "theme.light", Icon: SunIcon },
  { value: "dark", labelKey: "theme.dark", Icon: MoonIcon },
  { value: "system", labelKey: "theme.system", Icon: MonitorIcon },
]

export function ThemeToggle() {
  const { t } = useLocale()
  const { theme, setTheme, resolvedTheme } = useTheme()

  // `theme` is undefined during SSR — next-themes reads localStorage in a state
  // initialiser that bails when `window` is absent. Rendering a theme-dependent
  // icon before mount would therefore mismatch on hydration, so the trigger
  // renders a fixed icon until the real value is known. The button stays in the
  // layout the whole time; only which glyph it shows waits.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // The pre-mount guess is the app's default theme, so the common case — a
  // first-time visitor, who has no stored preference — sees the right glyph
  // immediately rather than a moon that swaps to a sun a frame later.
  const active = mounted ? (resolvedTheme ?? "light") : "light"
  const TriggerIcon = active === "light" ? SunIcon : MoonIcon

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t("nav.theme")}>
          <TriggerIcon />
        </Button>
      </DropdownMenuTrigger>
      {/* Wider than the trigger: DropdownMenuContent is sized to the trigger by
          default, and this trigger is a 28px square. */}
      <DropdownMenuContent align="end" className="min-w-36">
        {THEMES.map(({ value, labelKey, Icon }) => (
          <DropdownMenuItem
            key={value}
            onSelect={() => setTheme(value)}
            // `theme`, not `resolvedTheme`: the tick belongs on what the reader
            // chose. With "system" selected, `resolvedTheme` is light or dark,
            // and ticking that would say they had picked it outright.
            data-active={mounted && theme === value ? "" : undefined}
            className="data-active:bg-accent"
          >
            <Icon />
            {t(labelKey)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
