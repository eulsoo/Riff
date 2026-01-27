import { Event } from '../types';
import { createEvent } from './api';
import * as ICAL from 'ical.js';

/**
 * ICS 파일을 파싱하여 이벤트 배열로 변환
 */
export function parseICSFile(icsContent: string): Omit<Event, 'id'>[] {
  const events: Omit<Event, 'id'>[] = [];
  
  try {
    const jcalData = ICAL.parse(icsContent);
    const comp = new ICAL.Component(jcalData);
    
    // 모든 VEVENT 컴포넌트 찾기
    const vevents = comp.getAllSubcomponents('vevent');
    
    for (const vevent of vevents) {
      const parsed = parseICalEvent(vevent);
      if (parsed) {
        events.push(parsed);
      }
    }
  } catch (error) {
    console.error('ICS 파일 파싱 실패:', error);
    throw new Error('ICS 파일 형식이 올바르지 않습니다.');
  }
  
  return events;
}

/**
 * ICAL Component를 Event 형식으로 변환
 */
function parseICalEvent(vevent: ICAL.Component): Omit<Event, 'id'> | null {
  try {
    const summary = vevent.getFirstPropertyValue('summary') || '';
    const description = vevent.getFirstPropertyValue('description') || '';
    const dtstart = vevent.getFirstPropertyValue('dtstart');
    const dtend = vevent.getFirstPropertyValue('dtend');
    const color = vevent.getFirstPropertyValue('color') || '#3b82f6';
    
    if (!dtstart) return null;
    
    const startDate = dtstart.toJSDate();
    const date = startDate.toISOString().split('T')[0];
    
    let startTime: string | undefined;
    let endTime: string | undefined;
    
    // 시간 정보가 있는 경우 (하루 종일 이벤트가 아닌 경우)
    if (dtstart.isDate === false) {
      startTime = formatTime(startDate);
    }
    
    if (dtend && dtend.isDate === false) {
      endTime = formatTime(dtend.toJSDate());
    }
    
    return {
      date,
      title: summary || '(제목 없음)',
      memo: description || undefined,
      startTime,
      endTime,
      color,
    };
  } catch (error) {
    console.error('iCal 이벤트 파싱 실패:', error);
    return null;
  }
}

function formatTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * ICS 파일을 읽어서 이벤트를 가져오고 데이터베이스에 저장
 */
export async function importICSFile(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = async (e) => {
      try {
        const icsContent = e.target?.result as string;
        const events = parseICSFile(icsContent);
        
        let importedCount = 0;
        for (const event of events) {
          const result = await createEvent(event);
          if (result) importedCount++;
        }
        
        resolve(importedCount);
      } catch (error: any) {
        reject(new Error(error.message || 'ICS 파일을 가져올 수 없습니다.'));
      }
    };
    
    reader.onerror = () => {
      reject(new Error('파일을 읽을 수 없습니다.'));
    };
    
    reader.readAsText(file);
  });
}
