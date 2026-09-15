import { dueInfo } from './tasks.js';

export function computeStats(tasks, completions, rooms) {
  const now = new Date();
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(now.getDate() - 7);
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(now.getDate() - 30);

  const overdueCount = tasks.filter((t) => dueInfo(t).overdue).length;
  const last7 = completions.filter((c) => new Date(c.completed_at) >= sevenDaysAgo).length;
  const last30 = completions.filter((c) => new Date(c.completed_at) >= thirtyDaysAgo).length;

  const perRoom = rooms.map((room) => {
    const count = completions.filter((c) => new Date(c.completed_at) >= thirtyDaysAgo && c.tasks?.room_id === room.id).length;
    return { room: room.name, count };
  });
  const maxRoomCount = Math.max(1, ...perRoom.map((r) => r.count));

  return {
    totalTasks: tasks.length,
    overdueCount,
    last7,
    last30,
    perRoom,
    maxRoomCount,
  };
}
