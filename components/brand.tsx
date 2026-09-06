// Render the shared CleanBreak wordmark and home link.
// Render the shared CleanBreak wordmark and home link.
import Link from "next/link"

export function Brand({ fixture = false }: { fixture?: boolean }) {
  return (
    <Link className="brand" href={fixture ? "/demo" : "/"}>
      <span className="brand-mark" aria-hidden="true">
        <span />
      </span>
      <span className="brand-wordmark">
        CleanBreak
        {fixture ? <small>demo lab</small> : null}
      </span>
    </Link>
  )
}
