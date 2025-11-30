import { PrismaClient, Currency } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

const prisma = new PrismaClient();

export interface CreateExchangeRateInput {
  fromCurrency: Currency;
  toCurrency: Currency;
  rate: number;
  effectiveDate?: Date;
  createdBy?: string;
}

export class ExchangeRateService {
  /**
   * Get current exchange rate between two currencies.
   * Returns the most recent rate effective before or at now.
   */
  async getCurrentRate(
    organizationId: string,
    fromCurrency: Currency,
    toCurrency: Currency
  ): Promise<Decimal | null> {
    if (fromCurrency === toCurrency) {
      return new Decimal(1);
    }

    const rate = await prisma.exchangeRate.findFirst({
      where: {
        organizationId,
        fromCurrency,
        toCurrency,
        effectiveDate: {
          lte: new Date(),
        },
      },
      orderBy: {
        effectiveDate: 'desc',
      },
    });

    return rate ? rate.rate : null;
  }

  /**
   * Set a new exchange rate.
   */
  async setRate(
    organizationId: string,
    input: CreateExchangeRateInput
  ): Promise<any> {
    return prisma.exchangeRate.create({
      data: {
        organizationId,
        fromCurrency: input.fromCurrency,
        toCurrency: input.toCurrency,
        rate: new Decimal(input.rate),
        effectiveDate: input.effectiveDate || new Date(),
        createdBy: input.createdBy,
      },
    });
  }

  /**
   * Get exchange rate history.
   */
  async getHistory(
    organizationId: string,
    fromCurrency?: Currency,
    toCurrency?: Currency,
    limit = 20
  ): Promise<any[]> {
    const where: any = { organizationId };
    if (fromCurrency) where.fromCurrency = fromCurrency;
    if (toCurrency) where.toCurrency = toCurrency;

    return prisma.exchangeRate.findMany({
      where,
      orderBy: { effectiveDate: 'desc' },
      take: limit,
    });
  }

  /**
   * Convert amount between currencies.
   */
  async convert(
    organizationId: string,
    amount: number,
    fromCurrency: Currency,
    toCurrency: Currency
  ): Promise<number> {
    if (fromCurrency === toCurrency) {
      return amount;
    }

    const rate = await this.getCurrentRate(organizationId, fromCurrency, toCurrency);

    if (!rate) {
      // Try reverse rate
      const reverseRate = await this.getCurrentRate(organizationId, toCurrency, fromCurrency);
      if (reverseRate) {
        return new Decimal(amount).div(reverseRate).toNumber();
      }
      throw new Error(`No exchange rate found for ${fromCurrency} to ${toCurrency}`);
    }

    return new Decimal(amount).mul(rate).toNumber();
  }
}

export const exchangeRateService = new ExchangeRateService();
