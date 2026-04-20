import { db, meetingsTable } from "@gbos/core/db";

export function getAllMeetings() {
  return db.select().from(meetingsTable);
}

export function getMeetingById(meetingId: number) {
  return db.query.meetingsTable
    .findFirst({
      where: { id: meetingId },
    })
    .then((meeting) => {
      if (!meeting) throw new Error("Meeting not found");
      return meeting;
    });
}
