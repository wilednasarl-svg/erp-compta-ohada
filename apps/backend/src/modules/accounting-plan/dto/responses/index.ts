import { ApiProperty } from '@nestjs/swagger';

import type {
  AccountType,
  AccountingSystem,
  NormalBalance,
} from '../../types/accounting-system';

export class AccountViewResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty()
  code!: string;
  @ApiProperty()
  label!: string;
  @ApiProperty({ enum: [1, 2, 3, 4, 5, 6, 7, 8, 9] })
  class!: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  @ApiProperty({ enum: ['TITLE', 'POSTING'] })
  accountType!: AccountType;
  @ApiProperty({ enum: ['D', 'C'] })
  normalBalance!: NormalBalance;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  parentId!: string | null;
  @ApiProperty()
  isCustom!: boolean;
  @ApiProperty()
  isActive!: boolean;
}

export class ListAccountsResponse {
  @ApiProperty({ type: () => [AccountViewResponse] })
  accounts!: AccountViewResponse[];
}

export class AccountEnvelopeResponse {
  @ApiProperty({ type: () => AccountViewResponse })
  account!: AccountViewResponse;
}

export class ImportChartResponse {
  @ApiProperty()
  added!: number;
  @ApiProperty()
  skipped!: number;
}

export class ReferenceAccountViewResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty()
  code!: string;
  @ApiProperty()
  label!: string;
  @ApiProperty({ enum: [1, 2, 3, 4, 5, 6, 7, 8, 9] })
  class!: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  @ApiProperty({ enum: ['TITLE', 'POSTING'] })
  accountType!: AccountType;
  @ApiProperty({ enum: ['D', 'C'] })
  normalBalance!: NormalBalance;
  @ApiProperty({ type: String, isArray: true })
  applicableSystems!: ReadonlyArray<AccountingSystem>;
}

export class ListReferenceAccountsResponse {
  @ApiProperty({ type: () => [ReferenceAccountViewResponse] })
  accounts!: ReferenceAccountViewResponse[];
}
