// Find or create the intended named Browser profile.
export type SolariProfile = { id: string; name: string }

export interface ProfilesClient {
  list(): Promise<SolariProfile[]>
  create(options: { name: string }): Promise<SolariProfile>
  save(profileId: string, storageState: unknown): Promise<unknown>
}

export async function resolveReusableProfile(
  profiles: ProfilesClient,
  options: { configuredId?: string; name: string },
): Promise<{ id: string; created: boolean }> {
  const existing = await profiles.list()

  if (options.configuredId) {
    const configured = existing.find(
      (profile) => profile.id === options.configuredId,
    )
    if (!configured) {
      throw new Error("The configured Solari profile ID was not found.")
    }
    return { id: configured.id, created: false }
  }

  const named = existing.find((profile) => profile.name === options.name)
  if (named) return { id: named.id, created: false }

  const created = await profiles.create({ name: options.name })
  return { id: created.id, created: true }
}
