import { Client } from '@notionhq/client';
import { createEvents } from 'ics';

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const databaseId = process.env.NOTION_DATABASE_ID;

// Helper to extract exact times from Notion's date format
function parseDate(dateStr) {
  if (!dateStr) return null;
  const dateObj = new Date(dateStr);
  
  // If the Notion string contains a 'T', it has a specific time attached
  if (dateStr.includes('T')) {
    return [
      dateObj.getFullYear(),
      dateObj.getMonth() + 1, // ICS months are calculated 1-12
      dateObj.getDate(),
      dateObj.getHours(),
      dateObj.getMinutes()
    ];
  }
  // Otherwise, it treats it as an all-day event
  return [
    parseInt(dateStr.substring(0, 4)),
    parseInt(dateStr.substring(5, 7)),
    parseInt(dateStr.substring(8, 10))
  ];
}

// Helper to grab text regardless of whether it is a Dropdown (Select) or Text field in Notion
function getPropValue(prop) {
  if (!prop) return '';
  if (prop.select) return prop.select.name;
  if (prop.rich_text && prop.rich_text.length > 0) return prop.rich_text[0].plain_text;
  return '';
}

export default async function handler(req, res) {
  try {
    const response = await notion.databases.query({
      database_id: databaseId,
      filter: {
        property: 'Date',
        date: { is_not_empty: true },
      },
    });

    const events = response.results.map((page) => {
      // 1. Core Fields
      const title = page.properties.Name?.title[0]?.plain_text || 'Untitled Event';
      const dateData = page.properties.Date?.date;
      
      const start = parseDate(dateData?.start);
      const end = parseDate(dateData?.end);

      // 2. Extracting your bespoke Class Sessions fields
      const location = getPropValue(page.properties.Location);
      const course = getPropValue(page.properties.Course);
      const instructor = getPropValue(page.properties.Instructor);
      const sessionType = getPropValue(page.properties['Session Type']);
      const notes = getPropValue(page.properties.Notes);

      // 3. Formatting the calendar description block
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

      // Attach the end time if you entered one in Notion
      if (end) {
        event.end = end;
      }

      return event;
    });

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
