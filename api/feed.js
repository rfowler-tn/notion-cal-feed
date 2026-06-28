import { Client } from '@notionhq/client';
import { createEvents } from 'ics';

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const databaseId = process.env.NOTION_DATABASE_ID;

// Helper to extract exact times from Notion's date format
function parseDate(dateStr) {
  if (!dateStr) return null;
  const dateObj = new Date(dateStr);
  
  if (dateStr.includes('T')) {
    return [
      dateObj.getFullYear(),
      dateObj.getMonth() + 1,
      dateObj.getDate(),
      dateObj.getHours(),
      dateObj.getMinutes()
    ];
  }
  return [
    parseInt(dateStr.substring(0, 4)),
    parseInt(dateStr.substring(5, 7)),
    parseInt(dateStr.substring(8, 10))
  ];
}

// Helper to safely grab text from Notion properties
function getPropValue(prop) {
  if (!prop) return '';
  if (prop.select) return prop.select.name;
  if (prop.rich_text && prop.rich_text.length > 0) return prop.rich_text[0].plain_text;
  return '';
}

export default async function handler(req, res) {
  try {
    let allPages = [];
    let cursor = undefined;
    let hasMore = true;

    // 1. The Pagination Loop: Keep querying until 'hasMore' is false
    while (hasMore) {
      const response = await notion.databases.query({
        database_id: databaseId,
        start_cursor: cursor, // Tells Notion where to resume the search
        filter: {
          property: 'Date',
          date: { is_not_empty: true },
        },
      });

      // Add this batch of results to our master list
      allPages.push(...response.results);
      
      // Update our markers for the next loop
      cursor = response.next_cursor;
      hasMore = response.has_more;
    }

    // 2. Map the complete master list to the ICS event format
    const events = allPages.map((page) => {
      const title = page.properties.Name?.title[0]?.plain_text || 'Untitled Event';
      const dateData = page.properties.Date?.date;
      
      const start = parseDate(dateData?.start);
      const end = parseDate(dateData?.end);

      const location = getPropValue(page.properties.Location);
      const course = getPropValue(page.properties.Course);
      const instructor = getPropValue(page.properties.Instructor);
      const sessionType = getPropValue(page.properties['Session Type']);
      const notes = getPropValue(page.properties.Notes);

      let description = `Course: ${course}\nInstructor: ${instructor}\nType: ${sessionType}`;
      if (notes) {
        description += `\n\nNotes: ${notes}`;
      }
      description += `\n\nNotion Link: ${page.url}`;

      const event = {
        title: title,
        start: start,
        location: location,
        description: description,
        url: page.url,
      };

      if (end) {
        event.end = end;
      }

      return event;
    });

    // 3. Generate and serve the ICS file
    const { error, value } = createEvents(events);
    if (error) throw error;

    res.setHeader('Content-Type', 'text/calendar');
    res.setHeader('Content-Disposition', 'attachment; filename="notion-feed.ics"');
    res.status(200).send(value);
    
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Failed to generate calendar feed' });
  }
}
