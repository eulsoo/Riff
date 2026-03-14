export interface GoogleExternalDeleteOpts {
  calendarName: string;
  convertGoogleToLocal: (url: string) => string;
  relinkEventsByCalendarUrl: (remap: Map<string, string>, prefix: string) => Promise<void>;
  removeGoogleCalendar: (calId: string) => void;
  deleteEventsByCalendarUrl: (url: string) => Promise<void>;
}

export interface CalDAVExternalDeleteOpts {
  calendarName: string;
  /** createdFromApp=true인 경우: refreshMetadataWithServerList가 이미 변환한 새 로컬 URL */
  newLocalUrl?: string;
  relinkEventsByCalendarUrl: (remap: Map<string, string>, prefix: string) => Promise<void>;
  deleteEventsByCalendarUrl: (url: string) => Promise<void>;
}

/**
 * Google 외부 삭제 처리 — DataContext 404 catch에서 onCalendarDeletedExternally 콜백을 통해 호출.
 *
 * - createdFromApp=false (Google→Riff): 이벤트 삭제 + 메타데이터 제거
 * - createdFromApp=true  (Riff→Google): 로컬 URL로 전환 + 이벤트 re-link
 */
export const handleGoogleExternalDelete = async (
  calId: string,
  createdFromApp: boolean,
  opts: GoogleExternalDeleteOpts
): Promise<{ message: string; type: 'info' }> => {
  const url = `google:${calId}`;

  if (createdFromApp) {
    const newLocalUrl = opts.convertGoogleToLocal(url);
    await opts.relinkEventsByCalendarUrl(new Map([[url, newLocalUrl]]), '[ExternalDelete-Google-CreatedFromApp]');
    return {
      message: `Google 캘린더(${opts.calendarName})가 삭제되어 Riff 로컬 캘린더로 전환됐습니다.`,
      type: 'info',
    };
  }

  opts.removeGoogleCalendar(calId);
  await opts.deleteEventsByCalendarUrl(url);
  return {
    message: `Google에서 삭제된 캘린더(${opts.calendarName})를 Riff에서도 제거했습니다.`,
    type: 'info',
  };
};

/**
 * CalDAV 외부 삭제 처리 — refreshMetadataWithServerList 감지 후 호출.
 *
 * - createdFromApp=false (iCloud→Riff): 이벤트 삭제
 * - createdFromApp=true  (Riff→iCloud): 이벤트 re-link (newLocalUrl 필요 — urlRemap에서 획득)
 */
export const handleCalDAVExternalDelete = async (
  url: string,
  createdFromApp: boolean,
  opts: CalDAVExternalDeleteOpts
): Promise<{ message: string; type: 'info' }> => {
  if (createdFromApp && opts.newLocalUrl) {
    await opts.relinkEventsByCalendarUrl(new Map([[url, opts.newLocalUrl]]), '[ExternalDelete-CalDAV-CreatedFromApp]');
    return {
      message: `iCloud 캘린더(${opts.calendarName})가 삭제되어 Riff 로컬 캘린더로 전환됐습니다.`,
      type: 'info',
    };
  }

  await opts.deleteEventsByCalendarUrl(url);
  return {
    message: `iCloud에서 삭제된 캘린더(${opts.calendarName})를 Riff에서도 제거했습니다.`,
    type: 'info',
  };
};
