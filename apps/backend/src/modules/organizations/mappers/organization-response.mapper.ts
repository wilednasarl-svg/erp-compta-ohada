import type { OrganizationEntity } from '../entities/organization.entity';
import type { MembershipEntity } from '../../rbac/entities/membership.entity';
import type {
  CreateOrganizationResult,
  OrganizationSummary,
} from '../services/organizations.service';
import {
  type CreateOrganizationResponse,
  type ListOrganizationsResponse,
  type MembershipResponse,
  type OrganizationEnvelopeResponse,
  type OrganizationResponse,
  type OrganizationSummaryResponse,
} from '../dto/responses';

export function toOrganizationResponse(entity: OrganizationEntity): OrganizationResponse {
  return {
    id: entity.id,
    name: entity.name,
    slug: entity.slug,
    type: entity.type,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
    deletedAt: entity.deletedAt,
  };
}

export function toOrganizationSummaryResponse(
  summary: OrganizationSummary,
): OrganizationSummaryResponse {
  return {
    id: summary.id,
    name: summary.name,
    slug: summary.slug,
    role: summary.role,
  };
}

export function toMembershipResponse(entity: MembershipEntity): MembershipResponse {
  return {
    id: entity.id,
    userId: entity.userId,
    organizationId: entity.organizationId,
    roleId: entity.roleId,
    status: entity.status,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

export function toListOrganizations(
  summaries: ReadonlyArray<OrganizationSummary>,
): ListOrganizationsResponse {
  return { organizations: summaries.map(toOrganizationSummaryResponse) };
}

export function toOrganizationEnvelope(entity: OrganizationEntity): OrganizationEnvelopeResponse {
  return { organization: toOrganizationResponse(entity) };
}

export function toCreateOrganization(result: CreateOrganizationResult): CreateOrganizationResponse {
  return {
    organization: toOrganizationResponse(result.organization),
    membership: toMembershipResponse(result.membership),
    system: result.system,
  };
}
