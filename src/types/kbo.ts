export type PersonRef = { id: number; name: string } | null;

export type KboGame = {
  gameId: string;
  date: string;
  time: string;
  season: number;
  stadium: string;
  homeTeamCode: string;
  awayTeamCode: string;
  homeTeamName: string;
  awayTeamName: string;
  homeRank: number | null;
  awayRank: number | null;
  broadcast: string;

  status: {
    stateCode: string;
    cancelCode: string;
    cancelName: string;
    inning: number | null;
    topBottom: string | null;
  };

  score: {
    home: number | null;
    away: number | null;
  };

  startingPitchers: {
    away: PersonRef;
    home: PersonRef;
  };

  flags: {
    lineupAvailable: boolean;
    scoreAvailable: boolean;
    starterAnnounced: boolean;
  };
};

export type OddsInput = {
  awayMl: number | null;
  homeMl: number | null;

  awayHandicapLine: number | null;
  homeHandicapLine: number | null;

  awayHandicap: number | null;
  homeHandicap: number | null;

  totalLine: number | null;
  overOdds: number | null;
  underOdds: number | null;
};

export type Pick = {
  gameId: string;
  label: string;
  market: "ML" | "HANDICAP" | "TOTAL";
  odds: number | null;
  grade: "A" | "B" | "C";
  confidence: number;
  ev: number | null;
};
