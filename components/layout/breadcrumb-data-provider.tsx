"use client"

import * as React from "react"

import type { League } from "@/lib/data/types"

/** Just enough league data for the header to build a hierarchy breadcrumb. */
export type LeagueCrumb = Pick<League, "id" | "name" | "sport">

const BreadcrumbDataContext = React.createContext<{ leagues: LeagueCrumb[] }>({ leagues: [] })

export function BreadcrumbDataProvider({
  leagues,
  children,
}: {
  leagues: LeagueCrumb[]
  children: React.ReactNode
}) {
  return (
    <BreadcrumbDataContext.Provider value={{ leagues }}>{children}</BreadcrumbDataContext.Provider>
  )
}

export function useBreadcrumbData() {
  return React.useContext(BreadcrumbDataContext)
}
