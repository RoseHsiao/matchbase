import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

type AuthCardProps = {
  title: string
  description: string
  children: React.ReactNode
  footer?: React.ReactNode
}

/** Shared frame for the sign-in and sign-up forms. */
export function AuthCard({ title, description, children, footer }: AuthCardProps) {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {children}
        {footer ? <div className="text-center text-xs text-muted-foreground">{footer}</div> : null}
      </CardContent>
    </Card>
  )
}
